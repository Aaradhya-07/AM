#!/usr/bin/env python3
"""
QLoRA SFT + DPO Fine-Tuning Script for AnvilMark Open-Source Models on `aara@am-server`
======================================================================================
Targets:
  - `Qwen/Qwen3-8B` / `Qwen/Qwen3.5-9B` (Stage 1 Triage + Stage 2 Architect)
  - `google/gemma-4-12b-it`

Fits comfortably inside 12 GB VRAM on `am-server`'s RTX 3060 using 4-bit NF4 QLoRA
(rank=16, alpha=32, gradient checkpointing) and exports HuggingFace PEFT adapters
ready for `/home/aara/llama.cpp/convert_lora_to_gguf.py` -> `~/.config/anvilmark/models.ini`.

Usage on `aara@am-server`:
  python3 train-qlora-dpo.py \
    --base-model Qwen/Qwen3-8B \
    --sft-file data/architect-sft.jsonl \
    --dpo-file data/architect-dpo.jsonl \
    --output-dir out/anvilmark-architect-lora
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train AnvilMark QLoRA SFT + DPO adapter")
    parser.add_argument("--base-model", default="Qwen/Qwen3-8B", help="HF base model ID or local path")
    parser.add_argument("--sft-file", required=True, type=Path, help="JSONL file with messages[]")
    parser.add_argument("--dpo-file", type=Path, default=None, help="Optional JSONL file with prompt/chosen/rejected")
    parser.add_argument("--output-dir", required=True, type=Path, help="Output directory for PEFT LoRA adapter")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=2e-4)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main() -> None:
    args = parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig, PeftModel, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import DPOConfig, DPOTrainer, SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU required for 4-bit NF4 QLoRA training.")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
    )
    model = prepare_model_for_kbit_training(model)

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )

    sft_rows = load_jsonl(args.sft_file)
    sft_ds = Dataset.from_list(sft_rows)

    sft_dir = args.output_dir / "sft"
    sft_cfg = SFTConfig(
        output_dir=str(sft_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=args.lr,
        bf16=True,
        gradient_checkpointing=True,
        max_length=args.max_seq_len,
        logging_steps=5,
        save_strategy="no",
    )

    sft_trainer = SFTTrainer(
        model=model,
        args=sft_cfg,
        train_dataset=sft_ds,
        peft_config=peft_config,
        processing_class=tokenizer,
    )
    sft_trainer.train()

    final_dir = args.output_dir / "final"
    if args.dpo_file and args.dpo_file.exists():
        sft_trainer.model.save_pretrained(str(sft_dir))
        dpo_rows = load_jsonl(args.dpo_file)
        dpo_ds = Dataset.from_list(dpo_rows)

        base_for_dpo = AutoModelForCausalLM.from_pretrained(
            args.base_model,
            quantization_config=bnb_config,
            device_map="auto",
            torch_dtype=torch.bfloat16,
        )
        policy_model = PeftModel.from_pretrained(
            prepare_model_for_kbit_training(base_for_dpo),
            str(sft_dir),
            is_trainable=True,
        )

        dpo_cfg = DPOConfig(
            output_dir=str(final_dir),
            num_train_epochs=2,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            learning_rate=5e-5,
            beta=0.1,
            bf16=True,
            gradient_checkpointing=True,
            max_length=args.max_seq_len,
            logging_steps=5,
            save_strategy="no",
        )
        dpo_trainer = DPOTrainer(
            model=policy_model,
            ref_model=None,
            args=dpo_cfg,
            train_dataset=dpo_ds,
            processing_class=tokenizer,
        )
        dpo_trainer.train()
        dpo_trainer.model.save_pretrained(str(final_dir))
    else:
        sft_trainer.model.save_pretrained(str(final_dir))

    tokenizer.save_pretrained(str(final_dir))
    print(json.dumps({"ok": True, "adapter_dir": str(final_dir)}, indent=2))


if __name__ == "__main__":
    main()
