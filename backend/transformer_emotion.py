"""Optional Transformer emotion inference backend.

This module is deliberately lazy: torch/transformers are imported only when the
feature is enabled and a checkpoint path/model name is configured.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional


DEFAULT_LABELS = ["neutral", "happy", "sad", "angry", "fear", "surprise"]


class TransformerEmotionModel:
    def __init__(self, model_path_or_name: str, max_length: int = 128, device: str = "auto"):
        self.model_path_or_name = model_path_or_name
        self.max_length = max_length
        self.device_name = device
        self.available = False
        self.load_error: Optional[str] = None
        self._torch = None
        self._tokenizer = None
        self._model = None
        self._labels = DEFAULT_LABELS
        self._load()

    def _load(self) -> None:
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            self._torch = torch
            if self.device_name == "auto":
                self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            else:
                self.device = torch.device(self.device_name)
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_path_or_name)
            self._model = AutoModelForSequenceClassification.from_pretrained(self.model_path_or_name)
            self._model.to(self.device)
            self._model.eval()
            id2label = getattr(self._model.config, "id2label", None) or {}
            labels = []
            for index in range(getattr(self._model.config, "num_labels", len(DEFAULT_LABELS))):
                label = id2label.get(index) or id2label.get(str(index)) or DEFAULT_LABELS[index]
                labels.append(str(label))
            self._labels = labels
            self.available = True
        except Exception as exc:
            self.load_error = str(exc)
            self.available = False

    def predict_base_probabilities(self, text: str) -> dict[str, float]:
        if not self.available or self._tokenizer is None or self._model is None or self._torch is None:
            raise RuntimeError(self.load_error or "Transformer emotion model is not available")
        encoded = self._tokenizer(
            text,
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        encoded = {key: value.to(self.device) for key, value in encoded.items()}
        with self._torch.no_grad():
            logits = self._model(**encoded).logits[0]
            probs = self._torch.softmax(logits, dim=-1).detach().cpu().tolist()
        return {self._labels[index]: float(probability) for index, probability in enumerate(probs)}


def resolve_model_path(backend_dir: str, configured: str) -> str:
    value = (configured or "").strip()
    if not value:
        return ""
    path = Path(value)
    if path.is_absolute():
        return str(path) if path.exists() else ""
    local = Path(backend_dir) / value
    if local.exists():
        return str(local)
    if value.startswith(".") or "\\" in value:
        return ""
    return value
