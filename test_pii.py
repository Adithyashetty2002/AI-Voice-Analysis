import torch
from transformers import pipeline

device = 0 if torch.cuda.is_available() else -1
pii_pipeline = pipeline(
    "token-classification",
    model="openai/privacy-filter",
    aggregation_strategy="simple",
    device=device,
    trust_remote_code=True
)

text = "Yes, it's 1255 North Research Way. That's in Orem, Utah 84097, and my phone number is A01 -431 -1000. Well,"
results = pii_pipeline(text)
print("RESULTS:", results)
