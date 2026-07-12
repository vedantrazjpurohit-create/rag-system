.PHONY: install test bench chart api

PYTHON := .venv/Scripts/python.exe
export HF_HOME := $(CURDIR)/.hf_cache

install:
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m pytest api/tests eval/tests -q

bench:
	$(PYTHON) scripts/regenerate_benchmarks.py

api:
	$(PYTHON) -m uvicorn api.app.main:app --reload --app-dir api
