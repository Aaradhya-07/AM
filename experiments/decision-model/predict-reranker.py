"""Classify a message against caller-defined labels with the trained two-stage model.

Scores are rankings, not calibrated probabilities. Labels should be descriptive
phrases. This checkpoint was trained on intent data; separate transfer checks
show that arbitrary binary or ordinal questions remain unreliable.
"""

from __future__ import annotations

import argparse
import json
import runpy
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class DynamicLabelClassifier:
    def __init__(self, device="auto", checkpoint=None):
        prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
        self.rules = runpy.run_path(str(ROOT / "train-reranker.py"))
        self.torch, self.tokenizer, self.retriever = prototype["load_encoder"]()
        self.torch.set_num_threads(4)
        self.device = ("cuda" if self.torch.cuda.is_available() else "cpu") if device == "auto" else device
        if self.device == "cuda" and not self.torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable")
        saved = self.torch.load(
            checkpoint or ROOT / ".cache" / "label-aware-reranker.pt",
            map_location="cpu", weights_only=True,
        )
        if saved["encoder_revision"] != prototype["MODEL_REVISION"]:
            raise ValueError("checkpoint encoder revision changed")
        self.retriever.to(self.device).eval()
        _, _, self.reranker = prototype["load_encoder"]()
        self.reranker.load_state_dict(saved["encoder_state"])
        self.reranker.to(self.device).eval()
        self.head = self.torch.nn.Linear(self.reranker.config.hidden_size, 1)
        self.head.load_state_dict(saved["head_state"])
        self.head.to(self.device).eval()
        self.fusion_weight = saved["fusion_weight"]
        self.top_k = saved["shortlist_k"]
        self.labels = None
        self.label_vectors = None

    def _encode(self, texts):
        inputs = self.tokenizer(
            texts, padding=True, truncation=True, max_length=128,
            return_tensors="pt",
        ).to(self.device)
        with self.torch.inference_mode():
            hidden = self.retriever(**inputs).last_hidden_state
            mask = inputs["attention_mask"].unsqueeze(-1)
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
            return self.torch.nn.functional.normalize(pooled, dim=-1)

    def set_labels(self, labels):
        if (not isinstance(labels, list) or len(labels) < 2 or
                any(not isinstance(label, str) or not label.strip() for label in labels) or
                len(set(labels)) != len(labels)):
            raise ValueError("labels must be at least two distinct, nonempty strings")
        self.labels = list(labels)
        with self.torch.inference_mode():
            self.label_vectors = self._encode([
                self.rules["readable_label"](label) for label in labels
            ])

    def predict(self, text):
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must be nonempty")
        if self.labels is None:
            raise ValueError("call set_labels before predict")
        started = time.perf_counter()
        with self.torch.inference_mode():
            similarity = (self._encode([text]) @ self.label_vectors.T).flatten()
            values, indexes = similarity.topk(min(self.top_k, len(self.labels)))
            candidates = [self.labels[i] for i in indexes.tolist()]
            inputs = self.rules["tokenize_pairs"](
                self.tokenizer, [text] * len(candidates),
                [self.rules["readable_label"](label) for label in candidates],
            )
            inputs = {key: value.to(self.device) for key, value in inputs.items()}
            with self.torch.autocast(
                "cuda", dtype=self.torch.float16, enabled=self.device == "cuda"
            ):
                hidden = self.reranker(**inputs).last_hidden_state
                mask = inputs["attention_mask"].unsqueeze(-1)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
                logits = self.head(pooled).flatten().float()
            rerank_ranks = logits.argsort(descending=True).argsort().float()
            retrieval_ranks = self.torch.arange(len(candidates), device=self.device).float()
            fused_rank = ((1 - self.fusion_weight) * retrieval_ranks +
                          self.fusion_weight * rerank_ranks)
            order = sorted(range(len(candidates)), key=lambda i: (float(fused_rank[i]), i))
            if self.device == "cuda":
                self.torch.cuda.synchronize()
        ranking = [{
            "label": candidates[i],
            "retrieval_similarity": round(float(values[i]), 6),
            "reranker_logit": round(float(logits[i]), 6),
            "fused_rank": round(float(fused_rank[i]), 6),
        } for i in order]
        return {
            "choice": ranking[0]["label"],
            "ranking": ranking,
            "candidate_count": len(self.labels),
            "shortlist_count": len(candidates),
            "elapsed_ms_excluding_model_load_and_label_setup": round(
                1000 * (time.perf_counter() - started), 3
            ),
            "scores_calibrated": False,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True)
    parser.add_argument("--labels", required=True, help="JSON array of label names")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    args = parser.parse_args()
    classifier = DynamicLabelClassifier(args.device)
    classifier.set_labels(json.loads(args.labels))
    print(json.dumps(classifier.predict(args.text), indent=2))


if __name__ == "__main__":
    main()
