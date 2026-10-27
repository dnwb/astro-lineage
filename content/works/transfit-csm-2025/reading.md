---
work_id: work:transfit-csm-2025
---

# TransFit-CSM: A Fast, Physically Consistent Framework for Interaction-Powered Transients

## Why This Work Matters

A major state-of-the-art computational framework for interaction-powered transients. It resolves the long-standing limitation of static diffusion boundaries by evolving photon escape paths dynamically as the shock traverses the CSM.

## Problem

As shock fronts advance through dense CSM, heating boundaries and optical depths evolve dynamically. How can time-dependent diffusion be modeled rigorously while remaining fast enough for statistical MCMC fits?

## Scientific takeaway

Presents TransFit-CSM, solving the moving-boundary partial differential equation $$\frac{\partial E}{\partial t}=\frac{1}{r^2}\frac{\partial}{\partial r}\left(r^2D\frac{\partial E}{\partial r}\right)+Q$$. Self-consistently reproduces early dark phases, shock breakout peaks, and delayed cooling tails within a unified solver.

## Assumptions

- Dynamic shock ram-pressure balance coupled with LTE photon diffusion across expanding layers.
- Adaptive radial grids tracking moving shock boundaries with Rosseland mean opacity prescriptions.
- Spherical geometry without catastrophic multidimensional jet puncture.

## Scientific delta

Replaces static-diffusion heuristics with the first high-performance solver that simultaneously captures dynamic shock boundaries, evolving optical depths, and rapid statistical parameter fitting.

## Reason to read

Primary methodological reference for analyzing interaction-powered transients. Focus on the spatial discretization of diffusion on dynamic grids and the coupling of shock source terms $Q(r,t)$.
