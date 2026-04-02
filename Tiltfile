CHECKPOINT = "checkpoints/MolmoWeb-4B"

local_resource(
    'setup',
    cmd='uv sync --frozen && uv run playwright install chromium',
    dir='.',
    labels=['setup'],
)

local_resource(
    'model-server',
    serve_cmd='CKPT=' + CHECKPOINT + ' PORT=8001 PREDICTOR_TYPE=hf uv run uvicorn agent.fastapi_model_server:app --host 127.0.0.1 --port 8001 --log-config config/uvicorn_logging.json',
    serve_dir='.',
    readiness_probe=probe(
        http_get=http_get_action(port=8001, path='/status'),
        initial_delay_secs=30,
        period_secs=10,
        timeout_secs=5,
    ),
    resource_deps=['setup'],
    labels=['backend'],
)

local_resource(
    'webui',
    serve_cmd='MOLMOWEB_MODEL_ENDPOINT=http://127.0.0.1:8001 uv run uvicorn webui.app:app --host 0.0.0.0 --port 8010 --log-config config/uvicorn_logging.json',
    serve_dir='.',
    readiness_probe=probe(
        http_get=http_get_action(port=8010, path='/api/status'),
        initial_delay_secs=5,
        period_secs=10,
        timeout_secs=5,
    ),
    resource_deps=['setup', 'model-server'],
    links=[
        link('http://127.0.0.1:8010', 'WebUI'),
        link('http://127.0.0.1:8001/status', 'Model Status'),
    ],
    labels=['frontend'],
)
