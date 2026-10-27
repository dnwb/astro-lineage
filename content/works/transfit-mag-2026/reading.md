---
work_id: work:transfit-mag-2026
---

# \texttt{TransFit-MAG}: Self-Consistent Modeling of Magnetar-Powered Transients from Shock Breakout to Spin-Down Heating

## Why This Work Matters

The contemporary computational benchmark for magnetar transients. It moves beyond ad-hoc central heating curves to self-consistently couple magnetar-wind-inflated cavity dynamics, forward shock propagation, and time-dependent radiative diffusion.

## Problem

As a magnetar wind drives a forward shock outward through expanding ejecta, how can moving-boundary shock heating, adiabatic expansion losses, and non-steady diffusion be unified to compute multi-peaked light curves?

## Scientific takeaway

Constructs the TransFit-MAG framework solving the coupled radiation diffusion equation $$\frac{\partial E}{\partial t} + \nabla\cdot F = Q_{\rm sd}-P\nabla\cdot v$$. Uncovers how forward shock heating interacts with photon escape to synthesize double peaks, merged shoulders, or broad luminous light curves.

## Assumptions

- 1D spherical homologous expansion with a magnetar wind driving an interior shock wave.
- Radiative transfer handled via multi-grid, time-dependent diffusion with flux limiters.
- Dipole spin-down energy is efficiently thermalized into radiation and mechanical expansion work.

## Scientific delta

Replaces the simplistic central-point heating approximation with a rigorous spatial solver that tracks moving shock fronts and dynamic photon diffusion depths.

## Reason to read

Core methodological paper for our research group on magnetar modeling. Focus on the Crank-Nicolson implicit scheme solving moving-boundary energy diffusion.
