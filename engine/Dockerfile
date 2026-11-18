# The clip engine: PeakCut's pipeline (studio/), ffmpeg, yt-dlp and the speech model, behind server.py.
# Built and pushed by `npx wrangler deploy` in engine/cloudflare (needs Docker running).
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates bzip2 fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JavaScript runtime for YouTube
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY studio studio

# The speech model (about 480 MB) goes into the image, so a job never waits for it to download.
ENV PEAKCUT_MODELS=/app/models \
    PYTHONUNBUFFERED=1
RUN PEAKCUT_DATA=/tmp/build python -c "from studio import fetch_model; fetch_model.ensure()" && rm -rf /tmp/build

# Our own files come after the model, so changing them doesn't download it again.
COPY runner.py editing.py live_source.py server.py PEAKCUT-LICENSE ./

ENV PORT=8080 \
    ENGINE_ONE_SHOT=1 \
    ENGINE_MAX_JOBS=1
EXPOSE 8080
CMD ["python", "server.py"]
