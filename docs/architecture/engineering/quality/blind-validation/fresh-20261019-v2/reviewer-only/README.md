# Reviewer-Only Boundary

Do not open this directory while the run is `sealed`, `running` or `frozen`.

Quality may read `answer-key.md` only after:

1. all six case reports exist;
2. every report passes canonical validation and exact-source verification;
3. the complete report manifest and its digest are frozen;
4. the run has entered `scoring`.

Reading this directory earlier invalidates the run. It does not return the
cases to the fresh pool.
