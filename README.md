# Freshness Tracker

A food freshness tracker with a Python engine, FastAPI backend, telemetry
simulator, and Expo mobile app.

This first stage establishes the repository layout and dependency manifests.
The application features and their tests will be added in subsequent stages;
the API and mobile app are not runnable yet.

## Repository layout

```text
apps/
  api/          FastAPI backend package
  mobile/       Expo mobile dependencies and TypeScript configuration
engine/         Freshness calculation package
simulator/      Telemetry simulation package
tests/
  api/          Backend tests
  engine/       Freshness engine tests
  simulator/    Telemetry simulation tests
docs/           Project documentation
```

## Dependency setup

Python 3.12 or newer is required. Create a virtual environment from the
repository root and install the Python dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
```

With Node.js and npm installed, install the mobile dependencies using the
committed lockfile:

```sh
cd apps/mobile
npm ci
```

The dependency manifests establish the stack for the planned features.
Setup and runtime instructions will expand as those features are added.
