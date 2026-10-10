# GPU image (AWS g4dn / g6, any host with the NVIDIA container toolkit).
# ctranslate2 4.x needs CUDA 12 + cuDNN 9 (see faster-whisper README); this base ships both.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /usr/local/bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
# uv downloads a managed Python 3.12 (Ubuntu 22.04 ships 3.10).
RUN uv python install 3.12 && uv sync --frozen --no-dev --extra api --python 3.12

COPY app ./app

# Non-root user with a writable model cache.
RUN useradd --create-home --uid 10001 transcriber \
    && mkdir -p /models && chown transcriber /models
ENV HF_HOME=/models \
    WHISPER_DEVICE=auto \
    WHISPER_MODEL=large-v3 \
    PORT=8080

# Optional: bake the model into the image (build with --build-arg PRELOAD_MODEL=large-v3).
ARG PRELOAD_MODEL=""
RUN if [ -n "$PRELOAD_MODEL" ]; then \
      python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-${PRELOAD_MODEL}')"; \
    fi \
    && chown -R transcriber /models

USER transcriber
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD curl -fsS http://localhost:8080/healthz || exit 1
CMD ["python", "-m", "app"]
