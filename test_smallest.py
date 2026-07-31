import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
smallest_key = os.getenv("SMALLEST_AI_API_KEY", "")
client = OpenAI(
    base_url="https://api.smallest.ai/waves/v1",
    api_key=smallest_key
)

try:
    rx = client.chat.completions.create(
        model="lightning",
        messages=[{"role": "user", "content": "Test"}],
        temperature=0.3
    )
    print("SUCCESS")
    print(rx.choices[0].message.content)
except Exception as e:
    print("FAILED")
    print(e)
