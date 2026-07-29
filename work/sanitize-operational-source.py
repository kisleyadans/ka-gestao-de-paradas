"""Remove operational records from the HTML source before public versioning."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lxml import etree, html


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "public" / "para360-operacional.html"

EMPTY_STATE = {
    "schema": "painel_pcm_itabira_v3",
    "exportedAt": "",
    "revision": "github-template-v1",
    "activities": [],
    "bloqueios": [],
    "desbloqueios": [],
    "desbloqueioSourceVersion": "",
    "desbloqueioBaseName": "",
    "contatos": [],
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
    "avancoLista",
    "avancoSupervisoesList",
    "contatosGrid",
}


def clear(element: etree._Element) -> None:
    element.text = ""
    for child in list(element):
        element.remove(child)


parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
parser.add_argument("--output", type=Path, default=DEFAULT_SOURCE)
args = parser.parse_args()

source_text = args.source.read_text(encoding="utf-8")
document = html.document_fromstring(
    source_text,
    parser=html.HTMLParser(encoding="utf-8", remove_comments=False),
)

# A cópia salva pelo navegador pode registrar o shell como já inicializado.
# Esse marcador impediria a instalação dos eventos do menu em uma nova carga.
document.attrib.pop("data-ka-offline-ready", None)
root_classes = (document.get("class") or "").split()
remaining_root_classes = [item for item in root_classes if item != "ka-app-shell"]
if remaining_root_classes:
    document.set("class", " ".join(remaining_root_classes))
else:
    document.attrib.pop("class", None)

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

# Browser-saved HTML can capture an authenticated visual state. Public source
# must always start logged out; Firebase restores the real online state later.
body = document.find("body")
if body is not None:
    classes = (body.get("class") or "").split()
    body.set("class", " ".join(c for c in classes if c not in {"admin-mode", "bloq-admin-mode"}))

for element_id, text in {
    "pcmAdminState": "🔒 Modo consulta",
    "pcmAdminBtn": "🔐 Administrador",
    "kaSharedStatus": "Conectando ao Firebase...",
}.items():
    for element in document.xpath(f'//*[@id="{element_id}"]'):
        clear(element)
        element.text = text

for element in document.xpath('//*[@id="pcmLogoutBtn"]'):
    element.set("style", "display:none")

for element in document.xpath('//*[@id="kaSharedStatus"]'):
    element.set("class", "ka-shared-status")

# Do not publish comments that disclose example/default passwords.
for comment in document.xpath("//comment()"):
    if "senha padrão" in (comment.text or "").casefold():
        parent = comment.getparent()
        if parent is not None:
            parent.remove(comment)

result = "<!DOCTYPE html>\n" + etree.tostring(
    document, encoding="unicode", method="html", pretty_print=False
)
if 'src="/shared-sync.js"' not in result:
    result = result.replace(
        "</body>", '<script type="module" src="/shared-sync.js"></script>\n</body>'
    )
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(result, encoding="utf-8", newline="\n")

print(args.output)
print(f"bytes={len(result.encode('utf-8'))}")
