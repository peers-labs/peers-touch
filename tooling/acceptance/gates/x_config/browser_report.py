"""Keep API-backed Home evidence below the browser Journey claim boundary."""

from dataclasses import fields

from tooling.acceptance.core.evidence import EvidenceReport


class BrowserJourneyRequiredReport(EvidenceReport):
    def to_dict(self):
        report = super().to_dict()
        if self.status == "PASS":
            report.update(
                {
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False,
                }
            )
        return report


def require_browser_journey(
    report: EvidenceReport,
) -> BrowserJourneyRequiredReport:
    return BrowserJourneyRequiredReport(
        **{
            field.name: getattr(report, field.name)
            for field in fields(EvidenceReport)
        }
    )
