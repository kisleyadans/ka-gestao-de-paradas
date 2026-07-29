"""Remove operational records from the HTML source before public versioning."""

from __future__ import annotations

import json
from pathlib import Path

from lxml import etree, html


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "para360-operacional.html"

EMPTY_STATE = {
    "schema": "painel_pcm_itabira_v3",
    "exportedAt": "",
    "revision": "github-template-v1",
    "activities": [],
    "bloqueios": [],
    "desbloqueios": [],
    "limpezas": [],
    "meetingPlan": [],
    "progressSnapshots": [],
    "refTime": "",
}

# These containers are rebuilt by the page scripts after Firebase data arrives.
DYNAMIC_IDS = {
    "activityTable",
    "curveS",
    "discBars",
    "reportContent",
    "bloqueiosDashboardKPI",
    "bloqueiosTable",
    "limpezasTable",
    "controlHeatmap",
    "adherenceDashboard",
    "mgmtAreaSummaryGrid",
    "dashboardBloqueio",
    "dashboardLimpeza",
    "controlCritPath",
    "dashExtraScope",
    "dashPlanContent",
    "controlAllActivities",
    "dashDisciplineFarol",
    "dashboardBloqueiosPublico",
    "desbloqueioKpis",
    "desbloqueioInsights",
    "desbloqueioTimeline",
    "desbloqueioPhaseRisk",
    "desbloqueioTopResp",
    "desbloqueioSubestacao",
    "desbloqueioStatusMix",
    "desbloqueioPriorImpact",
    "desbloqueioPriorNext",
    "desbloqueiosTable",
}


def clear(element: etree._Element) -> None:
    element.text = ""
    for child in list(element):
        element.remove(child)


source_text = SOURCE.read_text(encoding="utf-8")
document = html.document_fromstring(
    source_text,
    parser=html.HTMLParser(encoding="utf-8", remove_comments=False),
)

embedded = document.get_element_by_id("dadosEmbutidos")
embedded.text = json.dumps(EMPTY_STATE, ensure_ascii=False, indent=2).replace(
    "</script", "<\\/script"
)

for element_id in DYNAMIC_IDS:
    matches = document.xpath(f'//*[@id="{element_id}"]')
    for element in matches:
        clear(element)

for datalist_id in ("respBloqueioOptions", "faseBloqueioOptions", "seBloqueioOptions"):
    for element in document.xpath(f'//datalist[@id="{datalist_id}"]'):
        clear(element)

result = "<!DOCTYPE html>\n" + etree.tostring(
    document, encoding="unicode", method="html", pretty_print=False
)
SOURCE.write_text(result, encoding="utf-8", newline="\n")

print(SOURCE)
print(f"bytes={len(result.encode('utf-8'))}")
