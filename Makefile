.PHONY: install test

PYTHON := .venv/Scripts/python.exe

install:
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m pytest api/tests eval/tests -q
