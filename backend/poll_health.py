import urllib.request
import urllib.error
import time

url = "https://four-stack.vercel.app/api/health"
print(f"Polling {url}...", flush=True)

for i in range(12):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req, timeout=10)
        print(f"SUCCESS on attempt {i+1}: HTTP {res.status}", flush=True)
        print(res.read().decode(), flush=True)
        break
    except urllib.error.HTTPError as e:
        body = e.read()[:200].decode(errors="ignore")
        print(f"Attempt {i+1}: HTTP {e.code} - {body.strip()}", flush=True)
    except Exception as e:
        print(f"Attempt {i+1}: Exception - {e}", flush=True)
    time.sleep(5)
