"""Entrypoint: `python -m app`. Uses our JSON logging instead of uvicorn's default config."""

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8080")),
        log_config=None,
        access_log=True,
    )


if __name__ == "__main__":
    main()
