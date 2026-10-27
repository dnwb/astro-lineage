---
work_id: work:liu-magnetar-2017
---

# A Monte Carlo Approach to Magnetar-powered Transients: I. Hydrogen-deficient Superluminous Supernovae

## Why This Work Matters

A benchmark work elevating magnetar transient modeling from qualitative fits to rigorous statistical MCMC inference. It systematically extracts multi-dimensional parameter posteriors ($B_p, P_0, M_{\rm ej}$) across a sample of hydrogen-poor SLSNe.

## Problem

How can multi-parameter degeneracies among magnetic field, initial spin, ejecta mass, and gamma-ray opacity be statistically broken and quantified across real SLSN light curves?

## Scientific takeaway

Employs an MCMC fitting pipeline minimizing $$\chi^2 = \sum_i \frac{(F_{i,\rm obs}-F_{i,\rm mod})^2}{\sigma_i^2}$$, finding that SLSN-I magnetar engines cluster at $P_0 \sim 1-5\text{ ms}$ and $B_p \sim (1-10)\times 10^{14}\text{ G}$, while demonstrating that dynamic wind acceleration significantly boosts ejecta velocities.

## Assumptions

- SLSN-I bolometric light curves are universally dominated by continuous magnetar dipole injection.
- High-energy radiation leakage is parameterized by an effective leakage opacity $\kappa_\gamma$.
- Measurement errors are Gaussian and priors cover physically plausible compact object parameter spaces.

## Scientific delta

Pioneers standardized statistical parameter estimation for magnetar transients, confirming the viability of the engine paradigm while establishing the dynamical acceleration effect on ejecta expansion.

## Reason to read

The primary reference for statistical parameter inference in engine-driven transients. Examine the two-dimensional posterior contours of $B_p$ versus $P_0$ and correlations with ejecta mass.
