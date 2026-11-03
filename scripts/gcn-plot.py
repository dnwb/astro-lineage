#!/usr/bin/env python3
"""
scripts/gcn-plot.py

Wavelength-Driven Publication-Grade Light-Curve Plotter for GCN Circular Photometry.
Integrates the wavelength-driven astronomical photometric model:
  - Filter effective wavelength (SVO Filter Profile Service) controls sorting & stable colors
  - Survey/instrument identity controls marker shape
  - Zero-homogenization & anti-deception disclosures (no unstated extinction or forced cross-band conversions)
  - Collision-avoiding legend placement (data overlap minimization)
  - Optional magnitude offset mode for separated multi-band light curves
  - Adaptive multi-panel layouts (main optical overview + optional feature zoom panel + shared-Δt X-ray/radio sub-panels)
  - TrueType/Vector preservation (Type 42 fonts for editable PDF/PS, pure text SVG, 300 DPI PNG)
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import json
import os
import re
import sys
from typing import Any

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# ---------------------------------------------------------------------------
# 1. Wavelength-Driven Color & Filter Table (SVO Filter Profile Service)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BandStyle:
    color: str
    offset: float
    wavelength_nm: float | None = None
    marker: str = "o"


@dataclass(frozen=True)
class FilterInfo:
    system: str
    band: str
    wavelength_nm: float
    color: str


BAND_COLORS: dict[str, str] = {
    "fuv": "#3f007d",
    "uvw2": "#54278f",
    "uvm2": "#6a51a3",
    "uvw1": "#807dba",
    "nuv": "#756bb1",
    "u": "#7b61ff",
    "b": "#3b5bdb",
    "gbp": "#2b8cbe",
    "g": "#1b9e77",
    "c": "#3b5bdb",
    "w": "#7f7f7f",
    "white": "#737373",
    "clear": "#737373",
    "open": "#737373",
    "v": "#66a61e",
    "r": "#d95f02",
    "o": "#e59f00",
    "i": "#8c6d31",
    "grp": "#8c510a",
    "z": "#6f4e37",
    "y": "#5d4037",
    "t": "#8c6d31",
    "j": "#8d5524",
    "h": "#6b4226",
    "k": "#4e342e",
    "ks": "#4e342e",
    "w1": "#5d4037",
    "w2": "#4e342e",
    "w3": "#3e2723",
    "w4": "#2d1b16",
}

FILTER_SYSTEMS: dict[str, dict[str, tuple[float, str]]] = {
    "galex": {
        "fuv": (154.885, BAND_COLORS["fuv"]),
        "nuv": (230.337, BAND_COLORS["nuv"]),
    },
    "uvot": {
        "uvw2": (208.395, BAND_COLORS["uvw2"]),
        "uvm2": (224.503, BAND_COLORS["uvm2"]),
        "uvw1": (268.167, BAND_COLORS["uvw1"]),
        "u": (352.088, BAND_COLORS["u"]),
        "white": (387.562, BAND_COLORS["white"]),
        "b": (434.528, BAND_COLORS["b"]),
        "v": (541.145, BAND_COLORS["v"]),
    },
    "johnson": {
        "u": (367.827, BAND_COLORS["u"]),
        "b": (436.505, BAND_COLORS["b"]),
        "v": (545.177, BAND_COLORS["v"]),
        "r": (698.586, BAND_COLORS["r"]),
        "i": (856.343, BAND_COLORS["i"]),
    },
    "cousins": {
        "r": (635.735, BAND_COLORS["r"]),
        "i": (782.865, BAND_COLORS["i"]),
    },
    "sdss": {
        "u": (360.804, BAND_COLORS["u"]),
        "g": (467.178, BAND_COLORS["g"]),
        "r": (614.112, BAND_COLORS["r"]),
        "i": (745.789, BAND_COLORS["i"]),
        "z": (892.278, BAND_COLORS["z"]),
    },
    "ps1": {
        "g": (481.016, BAND_COLORS["g"]),
        "w": (598.070, "#7f7f7f"),
        "r": (615.547, BAND_COLORS["r"]),
        "open": (643.187, BAND_COLORS["clear"]),
        "i": (750.303, BAND_COLORS["i"]),
        "z": (866.836, BAND_COLORS["z"]),
        "y": (961.360, BAND_COLORS["y"]),
    },
    "lsst": {
        "u": (375.120, BAND_COLORS["u"]),
        "g": (474.066, BAND_COLORS["g"]),
        "r": (617.234, BAND_COLORS["r"]),
        "i": (750.097, BAND_COLORS["i"]),
        "z": (867.890, BAND_COLORS["z"]),
        "y": (971.182, BAND_COLORS["y"]),
    },
    "ztf": {
        "g": (474.648, BAND_COLORS["g"]),
        "r": (636.638, BAND_COLORS["r"]),
        "i": (782.903, BAND_COLORS["i"]),
    },
    "atlas": {
        "c": (518.242, BAND_COLORS["c"]),
        "o": (662.982, BAND_COLORS["o"]),
    },
    "mephisto": {
        "u": (340.000, BAND_COLORS["u"]),
        "v": (390.000, BAND_COLORS["v"]),
        "g": (525.000, BAND_COLORS["g"]),
        "r": (630.000, BAND_COLORS["r"]),
        "i": (830.000, BAND_COLORS["i"]),
        "z": (970.000, BAND_COLORS["z"]),
    },
    "skymapper": {
        "u": (350.022, BAND_COLORS["u"]),
        "v": (387.868, BAND_COLORS["v"]),
        "g": (501.605, BAND_COLORS["g"]),
        "r": (607.685, BAND_COLORS["r"]),
        "i": (773.283, BAND_COLORS["i"]),
        "z": (912.025, BAND_COLORS["z"]),
    },
    "2mass": {
        "j": (1235.000, BAND_COLORS["j"]),
        "h": (1662.000, BAND_COLORS["h"]),
        "ks": (2159.000, BAND_COLORS["ks"]),
    },
    "gaia": {
        "gbp": (504.161, BAND_COLORS["gbp"]),
        "g": (585.088, BAND_COLORS["g"]),
        "grp": (769.074, BAND_COLORS["grp"]),
    },
    "tess": {
        "t": (745.264, BAND_COLORS["t"]),
    },
    "wise": {
        "w1": (3352.600, BAND_COLORS["w1"]),
        "w2": (4602.800, BAND_COLORS["w2"]),
        "w3": (11560.800, BAND_COLORS["w3"]),
        "w4": (22088.300, BAND_COLORS["w4"]),
    },
}

BAND_WAVELENGTH_NM: dict[str, float] = {
    "fuv": 154.885,
    "uvw2": 208.395,
    "uvm2": 224.503,
    "uvw1": 268.167,
    "nuv": 230.337,
    "u": 365.0,
    "b": 436.0,
    "gbp": 504.161,
    "g": 477.0,
    "c": 518.242,
    "w": 598.070,
    "white": 387.562,
    "clear": 550.0,
    "open": 643.187,
    "v": 545.0,
    "r": 623.0,
    "o": 662.982,
    "i": 763.0,
    "grp": 769.074,
    "z": 900.0,
    "y": 970.0,
    "t": 745.264,
    "j": 1235.0,
    "h": 1662.0,
    "ks": 2159.0,
    "k": 2159.0,
    "w1": 3352.6,
    "w2": 4602.8,
    "w3": 11560.8,
    "w4": 22088.3,
}

SYSTEM_ALIASES: dict[str, str] = {
    "swift": "uvot",
    "uvot": "uvot",
    "sloan": "sdss",
    "sdss": "sdss",
    "panstarrs": "ps1",
    "pan_starrs": "ps1",
    "pan-starrs": "ps1",
    "ps1": "ps1",
    "palomar": "ztf",
    "ztf": "ztf",
    "atlas": "atlas",
    "mephisto": "mephisto",
    "mep": "mephisto",
    "lsst": "lsst",
    "rubin": "lsst",
    "skymapper": "skymapper",
    "2mass": "2mass",
    "twomass": "2mass",
    "gaia": "gaia",
    "galex": "galex",
    "tess": "tess",
    "wise": "wise",
    "johnson": "johnson",
    "cousins": "cousins",
}

BAND_ALIASES: dict[str, str] = {
    "cyan": "c",
    "orange": "o",
    "clear": "clear",
    "open": "open",
    "white": "white",
    "l": "clear",
    "bp": "gbp",
    "gbp": "gbp",
    "g_bp": "gbp",
    "gblue": "gbp",
    "rp": "grp",
    "grp": "grp",
    "g_rp": "grp",
    "gred": "grp",
    "rc": "r",
    "r_c": "r",
    "ic": "i",
    "i_c": "i",
    "ks": "ks",
    "k_s": "ks",
    "hs": "h",
    "h_s": "h",
    "red": "t",
    "vtb": "b",
    "vt_b": "b",
    "vtr": "r",
    "vt_r": "r",
}

# Standard Survey and GCN Facility Markers
SURVEY_MARKERS: dict[str, str] = {
    # Surveys
    "ztf": "o",
    "slt": "s",
    "atlas": "^",
    "mephisto": "D",
    "swift": "v",
    "uvot": "v",
    "sdss": "P",
    "ps1": "X",
    "lsst": "h",
    "gaia": "*",
    "tess": "p",
    "wise": "8",
    # GCN Transient Facilities
    "goto": "*",
    "liverpool": "s",
    "pku": "o",
    "pku_60cm": "o",
    "not": "D",
    "alfosc": "D",
    "lco": "^",
    "kait": "v",
    "wfst": "p",
    "panzhihua": "h",
    "d50": "D",
    "ondrejov": "D",
    "ondrejov_d50": "D",
    "mirage": "P",
    "mdm": "P",
    "svom": "8",
    "gwac": "8",
    "fram": "x",
    "trt": "d",
}

# Fallback passband markers when survey is not specified
BAND_DEFAULT_MARKERS: dict[str, str] = {
    "u": "^",
    "b": "s",
    "g": "s",
    "c": "^",
    "v": "o",
    "r": "o",
    "o": "D",
    "i": "D",
    "z": "v",
    "y": "h",
    "j": "p",
    "h": "h",
    "k": "8",
    "ks": "8",
    "clear": "*",
    "white": "*",
    "other": "o",
}

# ---------------------------------------------------------------------------
# 2. Canonical Filter & Survey Resolvers
# ---------------------------------------------------------------------------

def _compact(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).strip().lower()).strip("_")

def normalize_system(system: str | None) -> str:
    if not system:
        return ""
    key = _compact(system)
    return SYSTEM_ALIASES.get(key, key)

def normalize_band_name(band: str) -> str:
    raw = str(band).replace("'", "").replace("prime", "")
    key = _compact(raw)
    key = key.replace("_filter", "").replace("_band", "")
    return BAND_ALIASES.get(key, key)

def _filter_info_table() -> dict[str, FilterInfo]:
    table: dict[str, FilterInfo] = {}
    for system, filters in FILTER_SYSTEMS.items():
        for band, (wavelength_nm, color) in filters.items():
            table[f"{system}_{band}"] = FilterInfo(
                system=system,
                band=band,
                wavelength_nm=wavelength_nm,
                color=color,
            )
    return table

FILTER_INFO: dict[str, FilterInfo] = _filter_info_table()

def canonical_filter_key(band: str, system: str | None = None) -> str:
    if system:
        sys_key = normalize_system(system)
        band_key = normalize_band_name(band)
        key = f"{sys_key}_{band_key}"
        if key in FILTER_INFO:
            return key
        if sys_key == "atlas" and band_key in {"cyan", "orange"}:
            return f"atlas_{BAND_ALIASES[band_key]}"
        return band_key

    raw = str(band).strip()
    direct = _compact(raw)
    if direct in FILTER_INFO:
        return direct

    tokens = [tok for tok in re.split(r"[/.:_\-\s]+", raw.lower()) if tok]
    if len(tokens) >= 2:
        band_key = normalize_band_name(tokens[-1])
        for token in reversed(tokens[:-1]):
            sys_key = normalize_system(token)
            key = f"{sys_key}_{band_key}"
            if key in FILTER_INFO:
                return key
    return normalize_band_name(raw)

def base_band_name(band: str, system: str | None = None) -> str:
    key = canonical_filter_key(band, system=system)
    if key in FILTER_INFO:
        return FILTER_INFO[key].band
    return BAND_ALIASES.get(key, key)

def band_wavelength_nm(band: str, system: str | None = None) -> float:
    key = canonical_filter_key(band, system=system)
    if key in FILTER_INFO:
        return FILTER_INFO[key].wavelength_nm
    base = base_band_name(key)
    return BAND_WAVELENGTH_NM.get(base, 600.0)

def filter_color(band: str, system: str | None = None) -> str:
    key = canonical_filter_key(band, system=system)
    if key in FILTER_INFO:
        return FILTER_INFO[key].color
    base = base_band_name(key)
    return BAND_COLORS.get(base, "#475569")

def display_band(band: str, system: str | None = None) -> str:
    base = base_band_name(band, system=system)
    labels = {
        "fuv": "FUV",
        "nuv": "NUV",
        "uvw2": "UVW2",
        "uvm2": "UVM2",
        "uvw1": "UVW1",
        "gbp": "BP",
        "grp": "RP",
        "ks": "Ks",
        "w1": "W1",
        "w2": "W2",
        "w3": "W3",
        "w4": "W4",
        "clear": "Clear / L",
    }
    return labels.get(base, base)

def survey_marker(survey: str | None, default_marker: str = "o") -> str:
    if not survey:
        return default_marker
    compact = _compact(survey)
    for k, m in SURVEY_MARKERS.items():
        if k in compact or compact in k:
            return m
    return default_marker

# ---------------------------------------------------------------------------
# 3. Smart Collision-Avoidance Legend Scoring
# ---------------------------------------------------------------------------

def _legend_overlap_score(
    ax: mpl.axes.Axes,
    legend: mpl.legend.Legend,
    pad_px: float = 6.0,
    samples_per_segment: int = 8,
) -> float:
    """Computes an overlap penalty score between an in-axes legend and plotted points/lines."""
    renderer = ax.figure.canvas.get_renderer()
    bbox = legend.get_window_extent(renderer).expanded(1.04, 1.12)
    bbox = mpl.transforms.Bbox.from_extents(
        bbox.x0 - pad_px,
        bbox.y0 - pad_px,
        bbox.x1 + pad_px,
        bbox.y1 + pad_px,
    )
    axes_bbox = ax.get_window_extent(renderer)
    overlap_area = max(0.0, min(bbox.x1, axes_bbox.x1) - max(bbox.x0, axes_bbox.x0))
    overlap_area *= max(0.0, min(bbox.y1, axes_bbox.y1) - max(bbox.y0, axes_bbox.y0))
    outside_area = max(0.0, bbox.width * bbox.height - overlap_area)
    score = outside_area / 100.0

    # Penalize intersection with data lines and error bars
    for line in ax.lines:
        if not line.get_visible():
            continue
        try:
            x = np.asarray(line.get_xdata(orig=False), dtype=float)
            y = np.asarray(line.get_ydata(orig=False), dtype=float)
        except (TypeError, ValueError):
            continue
        finite = np.isfinite(x) & np.isfinite(y)
        if np.count_nonzero(finite) == 0:
            continue
        points = ax.transData.transform(np.column_stack([x[finite], y[finite]]))
        if len(points) > 1:
            fractions = np.linspace(0.0, 1.0, samples_per_segment)
            starts = points[:-1]
            deltas = points[1:] - points[:-1]
            points = (
                starts[:, None, :]
                + deltas[:, None, :] * fractions[None, :, None]
            ).reshape(-1, 2)
        inside = (
            (points[:, 0] >= bbox.x0)
            & (points[:, 0] <= bbox.x1)
            & (points[:, 1] >= bbox.y0)
            & (points[:, 1] <= bbox.y1)
        )
        score += float(np.count_nonzero(inside))
    return score

def lightcurve_legend_inside_clear(
    ax: mpl.axes.Axes,
    ncol: int = 1,
    locs: Iterable[str] = (
        "upper right",
        "lower right",
        "center right",
        "upper left",
        "lower left",
        "upper center",
        "lower center",
        "center left",
    ),
    **kwargs: Any,
) -> mpl.legend.Legend:
    """Places the legend in the axes location that minimizes overlap with plotted data."""
    fig = ax.figure
    best_loc: str = "upper right"
    best_score = np.inf

    for loc in locs:
        legend = ax.legend(ncol=ncol, loc=loc, **kwargs)
        fig.canvas.draw()
        score = _legend_overlap_score(ax, legend)
        legend.remove()
        if score < best_score:
            best_score = score
            best_loc = loc
        if score <= 0.0:
            break

    return ax.legend(ncol=ncol, loc=best_loc, **kwargs)

# ---------------------------------------------------------------------------
# 4. Publication-Grade Matplotlib RC Configuration
# ---------------------------------------------------------------------------

plt.rcParams["font.family"] = "sans-serif"
plt.rcParams["font.sans-serif"] = ["DejaVu Sans", "Arial", "Helvetica"]
plt.rcParams["mathtext.fontset"] = "dejavusans"
plt.rcParams["pdf.fonttype"] = 42
plt.rcParams["ps.fonttype"] = 42
plt.rcParams["svg.fonttype"] = "none"

plt.rcParams["axes.linewidth"] = 0.8
plt.rcParams["axes.edgecolor"] = "#1e293b"
plt.rcParams["axes.axisbelow"] = True
plt.rcParams["xtick.direction"] = "in"
plt.rcParams["ytick.direction"] = "in"
plt.rcParams["xtick.top"] = True
plt.rcParams["ytick.right"] = True
plt.rcParams["xtick.major.size"] = 4.5
plt.rcParams["ytick.major.size"] = 4.5
plt.rcParams["xtick.minor.size"] = 2.5
plt.rcParams["ytick.minor.size"] = 2.5
plt.rcParams["xtick.major.width"] = 0.8
plt.rcParams["ytick.major.width"] = 0.8
plt.rcParams["xtick.minor.width"] = 0.5
plt.rcParams["ytick.minor.width"] = 0.5

# ---------------------------------------------------------------------------
# 5. Core Multi-Panel Light-Curve Renderer
# ---------------------------------------------------------------------------

def render_light_curve(
    ledger_data: dict[str, Any],
    output_path: str,
    offset_step: float = 0.0,
    dpi: int = 300,
    export_svg: bool = False,
) -> None:
    primary_id = ledger_data.get("primary_id", "Transient Event")
    aliases = ledger_data.get("aliases", [])
    canonical_t0 = ledger_data.get("canonical_t0") or {}
    t0_inst = canonical_t0.get("instrument", "Trigger") if isinstance(canonical_t0, dict) else "Trigger"
    best_redshift = ledger_data.get("best_redshift") or {}
    photo_points = ledger_data.get("photometry_points", []) or []
    if len(photo_points) < 2:
        print(f"[gcn-plot.py] Insufficient optical/NIR photometry points ({len(photo_points)}) for {primary_id}; skipping plot generation.")
        return
    xray_points = ledger_data.get("xray_points", []) or []
    radio_points = ledger_data.get("radio_points", []) or []
    feature_zoom = ledger_data.get("feature_zoom") or {}
    zoom_enabled = feature_zoom.get("enabled", False) if isinstance(feature_zoom, dict) else False

    # Grid layout determination
    has_xray = len(xray_points) >= 2
    has_radio = len(radio_points) >= 2
    subpanel_rows = (1 if has_xray else 0) + (1 if has_radio else 0)
    has_subpanel = subpanel_rows > 0

    ncols = 2 if zoom_enabled else 1
    nrows = 1 + subpanel_rows
    height_ratios = [3.2] + [1.3] * subpanel_rows

    fig_w = 14.5 if zoom_enabled else 8.5
    fig_h = 6.2 + 1.8 * subpanel_rows

    fig = plt.figure(figsize=(fig_w, fig_h), dpi=dpi)

    gs = fig.add_gridspec(
        nrows,
        ncols,
        height_ratios=height_ratios,
        hspace=0.18,
        wspace=0.24 if zoom_enabled else 0.20,
    )
    ax_opt = fig.add_subplot(gs[0, 0])
    ax_zoom = fig.add_subplot(gs[0, 1]) if zoom_enabled else None

    current_row = 1
    ax_xray = None
    if has_xray:
        ax_xray = fig.add_subplot(gs[current_row, 0], sharex=ax_opt)
        current_row += 1

    ax_radio = None
    if has_radio:
        ax_radio = fig.add_subplot(gs[current_row, 0], sharex=ax_opt)
        current_row += 1

    # Header: Suptitle & Badges
    alias_str = f" / {' / '.join(aliases)}" if aliases else ""
    title_text = f"{primary_id}{alias_str} · GCN photometry"
    fig.suptitle(title_text, fontsize=14, fontweight="bold", y=0.985, color="#0f172a")

    subtitle_parts = []
    if canonical_t0.get("utc_iso"):
        iso_str = canonical_t0["utc_iso"].replace("T", " ")[:19]
        subtitle_parts.append(f"T₀ = {iso_str} UTC ({t0_inst})")
    if best_redshift and best_redshift.get("z") is not None:
        z_val = best_redshift["z"]
        z_type = best_redshift.get("type", "redshift")
        z_inst = f" · {best_redshift['instrument']}" if best_redshift.get("instrument") else ""
        subtitle_parts.append(f"z = {z_val} ({z_type}{z_inst})")
    multi_messenger = ledger_data.get("multi_messenger")
    if multi_messenger:
        mm_items = multi_messenger if isinstance(multi_messenger, list) else [multi_messenger]
        mm_badges = []
        for item in mm_items:
            if isinstance(item, dict):
                msgr = item.get("messenger") or item.get("type") or item.get("name")
                inst = item.get("instrument") or item.get("facility") or item.get("observatory")
                if msgr and inst:
                    mm_badges.append(f"{msgr} ({inst})")
                elif msgr or inst:
                    mm_badges.append(str(msgr or inst))
            elif isinstance(item, str) and item.strip():
                mm_badges.append(item.strip())
        if mm_badges:
            subtitle_parts.append(f"Multi-messenger: {', '.join(mm_badges)}")

    if subtitle_parts:
        fig.text(0.5, 0.942, "   |   ".join(subtitle_parts), ha="center", fontsize=9.2, color="#475569")

    # -----------------------------------------------------------------------
    # Wavelength-Driven Grouping & Styles
    # -----------------------------------------------------------------------
    # 1. Discover all unique canonical filters and sort by effective wavelength (UV -> NIR)
    raw_band_keys = {canonical_filter_key(pt.get("band", "other"), pt.get("system")) for pt in photo_points if pt.get("dt_hours") and pt.get("mag")}
    sorted_band_keys = sorted(raw_band_keys, key=lambda k: band_wavelength_nm(k))

    # Calculate magnitude offsets if requested (shorter wavelengths get positive offsets)
    center_idx = 0.5 * (len(sorted_band_keys) - 1)
    band_styles: dict[str, BandStyle] = {}
    for rank, key in enumerate(sorted_band_keys):
        w_nm = band_wavelength_nm(key)
        color = filter_color(key)
        offset = (center_idx - rank) * float(offset_step) if offset_step > 0 else 0.0
        base = base_band_name(key)
        default_m = BAND_DEFAULT_MARKERS.get(base, "o")
        band_styles[key] = BandStyle(color=color, offset=offset, wavelength_nm=w_nm, marker=default_m)

    # -----------------------------------------------------------------------
    # Panel (a): Optical / NIR Main Light Curve
    # -----------------------------------------------------------------------
    panel_a_title = "(a) Optical photometry from GCN Circulars" if zoom_enabled else "Optical photometry from GCN Circulars"
    ax_opt.set_title(panel_a_title, fontsize=10.5, fontweight="bold", pad=8, color="#1e293b", loc="left")
    ax_opt.set_xscale("log")
    ylabel = "Reported apparent magnitude" + (f" + offset (Δ={offset_step:g})" if offset_step > 0 else "")
    ax_opt.set_ylabel(ylabel, fontsize=9.5, labelpad=6, color="#1e293b")
    if not has_subpanel:
        ax_opt.set_xlabel(f"Observer-frame time since {t0_inst} trigger (hours)", fontsize=9.5, labelpad=6, color="#1e293b")
    else:
        plt.setp(ax_opt.get_xticklabels(), visible=False)

    ax_opt.grid(True, which="major", ls=":", color="#cbd5e1", alpha=0.7, lw=0.7)
    ax_opt.xaxis.set_minor_locator(ticker.LogLocator(base=10.0, subs=(0.2, 0.4, 0.6, 0.8), numticks=12))

    bands_plotted = set()
    mags_all: list[float] = []
    times_all: list[float] = []

    # Sort photo_points by effective wavelength so curves render in coherent spectral order
    sorted_points = sorted(
        photo_points,
        key=lambda p: band_wavelength_nm(canonical_filter_key(p.get("band", "other"), p.get("system")))
    )

    for pt in sorted_points:
        dt = pt.get("dt_hours")
        raw_mag = pt.get("mag")
        if dt is None or raw_mag is None or dt <= 0:
            continue

        band_key = canonical_filter_key(pt.get("band", "other"), pt.get("system"))
        b_style = band_styles.get(band_key, BandStyle(color="#475569", offset=0.0, wavelength_nm=600.0, marker="o"))
        mag = raw_mag + b_style.offset
        mags_all.append(mag)
        times_all.append(dt)

        # Marker selection: Survey/Telescope overrides band default if specified
        telescope = pt.get("telescope")
        marker = survey_marker(telescope, default_marker=b_style.marker)

        is_ul = pt.get("is_upper_limit", False)
        mag_err = pt.get("mag_err")
        is_open = (
            mag_err is None or
            mag_err == 0 or
            pt.get("time_approximate", False) or
            pt.get("version_conflict", False) or
            bool(pt.get("discrepancy_note"))
        )

        # Label with passband and wavelength/offset annotation
        disp = display_band(band_key)
        off_str = f" ({b_style.offset:+g})" if b_style.offset != 0 else ""
        sys_str = f" ({pt.get('system')})" if pt.get("system") else ""
        label_text = f"{disp}{sys_str}{off_str}"
        label_to_use = label_text if band_key not in bands_plotted else None
        bands_plotted.add(band_key)

        if is_ul:
            ax_opt.errorbar(
                dt, mag, yerr=0.35, uplims=True, fmt=marker,
                color=b_style.color, markersize=5.5, alpha=0.85,
                capsize=2.5, elinewidth=1.0, label=label_to_use
            )
        elif is_open:
            ax_opt.plot(
                dt, mag, marker=marker, color=b_style.color,
                markerfacecolor="none", markeredgewidth=1.8, markersize=7.0,
                alpha=0.95, label=label_to_use
            )
        else:
            ax_opt.errorbar(
                dt, mag, yerr=mag_err, fmt=marker,
                color=b_style.color, ecolor=b_style.color,
                markerfacecolor=b_style.color, markeredgecolor=b_style.color,
                markersize=6.0, elinewidth=1.1, capsize=2.2, alpha=0.92,
                label=label_to_use
            )

    if mags_all:
        ymin = min(mags_all) - 0.7
        ymax = max(mags_all) + 0.8
        ax_opt.set_ylim(ymax, ymin)
        ax_opt.yaxis.set_minor_locator(ticker.MultipleLocator(1.0))
    else:
        ax_opt.text(
            0.5, 0.5, "No optical/NIR photometry points reported in GCN circulars yet",
            transform=ax_opt.transAxes, ha="center", va="center",
            fontsize=9.5, color="#64748b", style="italic"
        )

    # Anti-Deception Disclosures Box
    disclaimer_text = (
        "• No Galactic-extinction correction applied here.\n"
        "• Photometric systems not homogenised across passbands.\n"
        "• Solid markers: detections with reported uncertainty.\n"
        "• Open markers: missing uncertainty, approximate epoch, or revision."
    )
    ax_opt.text(
        0.03, 0.035, disclaimer_text, transform=ax_opt.transAxes,
        fontsize=7.5, color="#475569", va="bottom", ha="left",
        bbox=dict(boxstyle="square,pad=0.4", fc="#f8fafc", ec="#cbd5e1", alpha=0.92)
    )

    # Smart legend placement (minimizes data collision)
    handles, labels = ax_opt.get_legend_handles_labels()
    if handles:
        lightcurve_legend_inside_clear(
            ax_opt, ncol=1 if len(handles) <= 8 else 2,
            frameon=True, fontsize=7.6, facecolor="#ffffff", edgecolor="#cbd5e1", framealpha=0.94
        )

    # -----------------------------------------------------------------------
    # Panel (b): Feature Zoom Panel (Late-Time Structural Departure)
    # -----------------------------------------------------------------------
    if zoom_enabled and ax_zoom is not None:
        z_title = feature_zoom.get("title", "Late-time plateau & rebrightening zoom")
        ax_zoom.set_title(f"(b) {z_title}", fontsize=10.5, fontweight="bold", pad=8, color="#1e293b", loc="left")
        ax_zoom.set_xscale("log")
        ax_zoom.xaxis.set_major_formatter(ticker.ScalarFormatter())
        ax_zoom.set_ylabel("Reported apparent magnitude", fontsize=9.5, labelpad=6, color="#1e293b")
        ax_zoom.set_xlabel(f"Observer-frame time since {t0_inst} trigger (hours)", fontsize=9.5, labelpad=6, color="#1e293b")
        ax_zoom.grid(True, which="major", ls=":", color="#cbd5e1", alpha=0.7, lw=0.7)
        ax_zoom.xaxis.set_minor_locator(ticker.LogLocator(base=10.0, subs=(0.2, 0.4, 0.6, 0.8), numticks=10))

        t_min = feature_zoom.get("t_min_hours", 8.0)
        t_max = feature_zoom.get("t_max_hours", 42.0)
        zoom_bands = set(feature_zoom.get("bands", ["r", "i"]))
        alpha_ref = feature_zoom.get("alpha_ref", 1.4)

        zoom_mags: list[float] = []
        zoom_times: list[float] = []

        for pt in sorted_points:
            dt = pt.get("dt_hours")
            mag = pt.get("mag")
            if dt is None or mag is None:
                continue
            b_key = canonical_filter_key(pt.get("band", "other"), pt.get("system"))
            base_b = base_band_name(b_key)
            if b_key not in zoom_bands and base_b not in zoom_bands and "other" not in zoom_bands:
                continue
            if not (t_min * 0.8 <= dt <= t_max * 1.2):
                continue

            zoom_mags.append(mag)
            zoom_times.append(dt)
            b_style = band_styles.get(b_key, BandStyle(color="#475569", offset=0.0, wavelength_nm=600.0, marker="o"))
            marker = survey_marker(pt.get("telescope"), default_marker=b_style.marker)

            is_ul = pt.get("is_upper_limit", False)
            mag_err = pt.get("mag_err")
            is_open = (
                mag_err is None or mag_err == 0 or
                pt.get("time_approximate", False) or
                pt.get("version_conflict", False) or
                bool(pt.get("discrepancy_note"))
            )

            if is_ul:
                ax_zoom.errorbar(
                    dt, mag, yerr=0.35, uplims=True, fmt=marker,
                    color=b_style.color, markersize=6.5, alpha=0.90,
                    capsize=2.8, elinewidth=1.1
                )
            elif is_open:
                ax_zoom.plot(
                    dt, mag, marker=marker, color=b_style.color,
                    markerfacecolor="none", markeredgewidth=2.0, markersize=8.0,
                    alpha=0.98
                )
            else:
                ax_zoom.errorbar(
                    dt, mag, yerr=mag_err, fmt=marker,
                    color=b_style.color, ecolor=b_style.color,
                    markerfacecolor=b_style.color, markeredgecolor=b_style.color,
                    markersize=6.5, elinewidth=1.2, capsize=2.8, alpha=0.95
                )

        ax_zoom.set_xlim(t_min, t_max)
        if zoom_mags:
            z_ymin = min(zoom_mags) - 0.5
            z_ymax = max(zoom_mags) + 0.6
            ax_zoom.set_ylim(z_ymax, z_ymin)
            ax_zoom.yaxis.set_minor_locator(ticker.MultipleLocator(0.5))

        # Explicit reference power law guide: m(t) = m_ref + 2.5 * alpha * log10(t / t_ref)
        if zoom_times and zoom_mags:
            t_ref = t_min * 1.15
            idx_near = int(np.argmin(np.abs(np.array(zoom_times) - t_ref)))
            m_ref = zoom_mags[idx_near]

            t_line = np.geomspace(t_min, t_max, 100)
            m_line = m_ref + 2.5 * alpha_ref * np.log10(t_line / t_ref)
            ax_zoom.plot(
                t_line, m_line, ls="--", color="#64748b", lw=1.2,
                label=f"Ref. decay ($\\alpha = {alpha_ref}$, power-law guide, not a fit)"
            )
            ax_zoom.legend(loc="upper left", fontsize=7.8, frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

        # Dynamic callout annotations
        callouts = feature_zoom.get("callouts", [])
        for co in callouts:
            c_dt = co.get("dt_hours")
            c_mag = co.get("mag")
            c_text = str(co.get("text", ""))
            if c_dt is None or c_mag is None:
                continue

            if "3\\sigma" in c_text and "$3\\sigma$" not in c_text:
                c_text = c_text.replace("3\\sigma", "$3\\sigma$")

            x_offset = 20 if c_dt < np.sqrt(t_min * t_max) else -75
            y_offset = -28 if c_mag < (min(zoom_mags or [20]) + max(zoom_mags or [20])) / 2 else 28

            ax_zoom.annotate(
                c_text,
                xy=(c_dt, c_mag),
                xytext=(x_offset, y_offset),
                textcoords="offset points",
                fontsize=8.0,
                color="#0f172a",
                bbox=dict(boxstyle="round,pad=0.3", fc="#ffffff", ec="#94a3b8", alpha=0.95),
                arrowprops=dict(
                    arrowstyle="->", color="#334155", lw=0.9,
                    shrinkA=0, shrinkB=4
                ),
            )

    # -----------------------------------------------------------------------
    # Panel (c): Shared-Δt X-ray Subpanel
    # -----------------------------------------------------------------------
    if has_xray and ax_xray is not None:
        ax_xray.set_xscale("log")
        ax_xray.set_yscale("log")
        ax_xray.set_ylabel(r"X-ray flux (erg cm$^{-2}$ s$^{-1}$)", fontsize=8.8, labelpad=6, color="#1e293b")
        if not has_radio:
            ax_xray.set_xlabel(f"Observer-frame time since {t0_inst} trigger (hours)", fontsize=9.5, labelpad=6, color="#1e293b")
        else:
            plt.setp(ax_xray.get_xticklabels(), visible=False)
        ax_xray.grid(True, which="major", ls=":", color="#cbd5e1", alpha=0.7, lw=0.7)

        seen_xray_labels = set()
        for xp in xray_points:
            xdt = xp.get("dt_hours")
            flux = xp.get("flux_erg_cm2_s")
            ferr = xp.get("flux_err")
            is_ul = xp.get("is_upper_limit", False)
            if xdt is None or flux is None or xdt <= 0 or flux <= 0:
                continue
            inst = xp.get("instrument", "X-ray")
            label = f"X-ray ({inst})"
            label_to_use = label if label not in seen_xray_labels else None
            seen_xray_labels.add(label)

            if is_ul:
                yerr_val = ferr if (ferr is not None and 0 < ferr < flux) else 0.4 * flux
                ax_xray.errorbar(
                    xdt, flux, yerr=yerr_val, uplims=True, fmt="o",
                    color="#0284c7", markersize=5.0, capsize=2.5, elinewidth=1.0,
                    label=label_to_use
                )
            elif ferr and ferr > 0:
                ax_xray.errorbar(
                    xdt, flux, yerr=ferr, fmt="o", color="#0284c7",
                    ecolor="#0284c7", capsize=2.5, markersize=5.0, elinewidth=1.0,
                    label=label_to_use
                )
            else:
                ax_xray.plot(xdt, flux, "o", color="#0284c7", markersize=5.0, label=label_to_use)

        handles, labels = ax_xray.get_legend_handles_labels()
        if handles:
            ax_xray.legend(loc="upper right", fontsize=7.8, frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    # -----------------------------------------------------------------------
    # Panel (d): Shared-Δt Radio Subpanel
    # -----------------------------------------------------------------------
    if has_radio and ax_radio is not None:
        ax_radio.set_xscale("log")
        ax_radio.set_yscale("log")
        ax_radio.set_ylabel("Radio flux density (mJy)", fontsize=8.8, labelpad=6, color="#1e293b")
        ax_radio.set_xlabel(f"Observer-frame time since {t0_inst} trigger (hours)", fontsize=9.5, labelpad=6, color="#1e293b")
        ax_radio.grid(True, which="major", ls=":", color="#cbd5e1", alpha=0.7, lw=0.7)

        RADIO_PALETTE = [
            {"color": "#009e73", "marker": "s"},
            {"color": "#d55e00", "marker": "D"},
            {"color": "#7c3aed", "marker": "^"},
            {"color": "#0072b2", "marker": "o"},
            {"color": "#cc79a7", "marker": "v"},
            {"color": "#b45309", "marker": "p"},
        ]
        group_cfgs: dict[str, dict[str, Any]] = {}
        seen_radio_labels = set()

        for rp in radio_points:
            rdt = rp.get("dt_hours")
            flux = rp.get("flux_mjy")
            ferr = rp.get("flux_err") if rp.get("flux_err") is not None else rp.get("flux_err_mjy")
            is_ul = rp.get("is_upper_limit", False)
            if rdt is None or flux is None or rdt <= 0 or flux <= 0:
                continue

            freq = rp.get("freq_ghz")
            tele = rp.get("telescope") or rp.get("instrument")
            if freq is not None and str(freq).strip():
                f_str = f"{freq} GHz" if "ghz" not in str(freq).lower() else str(freq)
                grp_name = f"{f_str} ({tele})" if tele else f_str
            elif tele:
                grp_name = str(tele)
            else:
                grp_name = "Radio"

            if grp_name not in group_cfgs:
                cfg_idx = len(group_cfgs) % len(RADIO_PALETTE)
                group_cfgs[grp_name] = RADIO_PALETTE[cfg_idx]

            rcfg = group_cfgs[grp_name]
            label_to_use = grp_name if grp_name not in seen_radio_labels else None
            seen_radio_labels.add(grp_name)

            if is_ul:
                yerr_val = ferr if (ferr is not None and 0 < ferr < flux) else 0.4 * flux
                ax_radio.errorbar(
                    rdt, flux, yerr=yerr_val, uplims=True, fmt=rcfg["marker"],
                    color=rcfg["color"], markersize=5.0, capsize=2.5, elinewidth=1.0,
                    label=label_to_use
                )
            elif ferr and ferr > 0:
                ax_radio.errorbar(
                    rdt, flux, yerr=ferr, fmt=rcfg["marker"],
                    color=rcfg["color"], ecolor=rcfg["color"],
                    capsize=2.5, markersize=5.0, elinewidth=1.0, label=label_to_use
                )
            else:
                ax_radio.plot(
                    rdt, flux, rcfg["marker"],
                    color=rcfg["color"], markersize=5.0, label=label_to_use
                )

        handles, labels = ax_radio.get_legend_handles_labels()
        if handles:
            ax_radio.legend(loc="upper right", fontsize=7.8, frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    # -----------------------------------------------------------------------
    # Multi-Format Export (PNG + Vector SVG)
    # -----------------------------------------------------------------------
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)

    plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
    print(f"Saved publication-grade GCN light curve: {output_path} ({dpi} DPI)")

    if export_svg or output_path.endswith(".png"):
        base_name, _ = os.path.splitext(output_path)
        svg_path = f"{base_name}.svg"
        plt.savefig(svg_path, format="svg", bbox_inches="tight")
        print(f"Saved publication-grade vector SVG: {svg_path}")

    plt.close(fig)

def main() -> None:
    parser = argparse.ArgumentParser(description="Plot publication-grade GCN light curve")
    parser.add_argument("--input", required=True, help="Path to structured event ledger JSON")
    parser.add_argument("--output", required=True, help="Path to output figure (PNG)")
    parser.add_argument("--offset-step", type=float, default=0.0, help="Magnitude offset step per band (default 0.0 for raw)")
    parser.add_argument("--dpi", type=int, default=300, help="Output DPI for raster format (default 300)")
    parser.add_argument("--svg", action="store_true", help="Also export vector SVG alongside PNG")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        ledger = json.load(f)

    render_light_curve(ledger, args.output, offset_step=args.offset_step, dpi=args.dpi, export_svg=args.svg)

if __name__ == "__main__":
    main()
