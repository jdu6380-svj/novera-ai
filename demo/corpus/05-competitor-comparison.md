---
document_id: asteria-competitor-brief-2026-07
company: Asteria Workcloud
product: RelayOS
document_type: competitor-comparison
version: 1.0
effective_date: 2026-07-18
owner: Product Strategy
fictional: true
---

# Fictional Competitor Brief: RelayOS, Kiteframe, and Copperlane

## Research note

This internal brief uses fictional desk-research notes collected on July 18, 2026. Kiteframe and Copperlane are invented competitors. The notes are directional, are not an independent security audit, and should not be used as a pricing or procurement commitment.

## Capability definitions

For this comparison, “custom roles” means an administrator can define permissions beyond a fixed role list. “Native integration” means a connector maintained in the product catalog. An API may still support a workflow even when a native connector is not listed.

## Permissions and integrations

### RelayOS (Asteria Workcloud)

RelayOS provides fixed workspace roles on every plan and custom roles on the fictional Enterprise plan. SAML SSO is available on Business and Enterprise plans. The catalog lists 14 native integrations, plus webhooks and a public API. The audit log retains events for 365 days on Enterprise.

### Kiteframe

Kiteframe provides fixed roles only. SAML SSO is listed on its fictional Enterprise plan. The catalog lists 27 native integrations and webhooks, but the notes did not find a public write API. The audit log retention listed in the notes is 90 days.

### Copperlane

Copperlane provides custom role templates and scoped integration permissions. SAML SSO is listed on all paid plans. The catalog lists 9 native integrations plus a public API. The audit log retention listed in the notes is 365 days.

## Comparison interpretation

Kiteframe has the broadest native connector count in this snapshot, while RelayOS and Copperlane expose a public API for bespoke integrations.

Copperlane has the clearest documented combination of custom roles and scoped integration permissions. RelayOS offers custom roles only on Enterprise, so plan fit matters when permission design is a buying criterion.

The brief does not compare implementation effort, uptime, security certifications, or total cost of ownership. Those topics require separate verified sources.

