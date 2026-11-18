"""Deterministic, locally trained synthetic fraud model."""

import os

# Tiny single-request trees do not benefit from BLAS thread pools. Set defaults
# before joblib/numpy/sklearn import to avoid startup memory spikes on many-core hosts.
for _variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_variable, "1")
