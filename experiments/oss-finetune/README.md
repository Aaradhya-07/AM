# AnvilMark OSS Fine-Tuning & Learned Neural Router (`aara@am-server`)

This directory contains the reproducible dataset builder, 4-bit NF4 QLoRA + DPO adapter trainer, and native CUDA neural router trainer targeting **`aara@am-server` (NVIDIA GeForce RTX 3060 12 GB)**.

## 1. Generate SFT, DPO, and Router Datasets

```sh
node experiments/oss-finetune/build-dataset.mjs
```

Writes to `experiments/oss-finetune/data/`:
- `triage-sft.jsonl` — Domain-specific clarifying questions (recommended option first) + proportional `elevatedBrief` outputs.
- `architect-sft.jsonl` — Multi-wave vertical capability plans spanning 2 to 10 slices with 2-option routing.
- `architect-dpo.jsonl` — Direct Preference Optimization `(prompt, chosen, rejected)` pairs contrasting vertical DAG plans against rejected 3-slice horizontal splits and `gpt-6-astra` overkill picks.
- `router-train.jsonl` / `router-val.jsonl` — 23-feature slice/stack/model/repo-outcome vectors (`9,874` train / `1,646` held-out validation rows, plus any local `.anvilmark/development/slice-outcomes.jsonl` rows).

## 2. Train the Sub-Millisecond Neural Router on `aara@am-server`

Compiles and runs a native CUDA kernel via `/usr/bin/nvcc` directly on `am-server`'s RTX 3060 and writes portable float weights to `packages/web/data/router-weights.v1.json`:

```sh
scp experiments/oss-finetune/train-neural-router.py aara@am-server:~/anvilmark-train/
scp experiments/oss-finetune/data/router-*.jsonl aara@am-server:~/anvilmark-train/data/
ssh aara@am-server 'cd ~/anvilmark-train && python3 train-neural-router.py \
  --train-file data/router-train.jsonl \
  --val-file data/router-val.jsonl \
  --weights-out out/router-weights.v1.json \
  --report-out out/router-eval.json \
  --epochs 1000'
scp aara@am-server:~/anvilmark-train/out/router-weights.v1.json packages/web/data/router-weights.v1.json
```

## 3. Fine-Tune `Qwen3.5-9B` / `Gemma-4-12B` QLoRA + DPO Adapters & Mount in `llama-server`

When running full LLM adapter training on `aara@am-server` (in a Python 3.12 CUDA venv with `torch`, `transformers`, `peft`, `trl`, `bitsandbytes`, `datasets`):

```sh
python3 train-qlora-dpo.py \
  --base-model Qwen/Qwen3-8B \
  --sft-file data/architect-sft.jsonl \
  --dpo-file data/architect-dpo.jsonl \
  --output-dir out/anvilmark-architect-lora

# Convert PEFT LoRA adapter to GGUF via llama.cpp on am-server:
python3 ~/llama.cpp/convert_lora_to_gguf.py \
  --outfile ~/models/lora/anvilmark-architect-qwen.gguf \
  out/anvilmark-architect-lora/final
```

Then attach the adapter in `/home/aara/.config/anvilmark/models.ini`:

```ini
[qwen3.5-9b]
model = /home/aara/models/Qwen3.5-9B-Q4_K_M.gguf
lora = /home/aara/models/lora/anvilmark-architect-qwen.gguf
c = 16384
load-on-startup = true
```
