---
document_id: asteria-relayos-release-notes-v3-8
company: Asteria Workcloud
product: RelayOS
document_type: product-release-notes
version: 3.8.2
effective_date: 2026-07-02
owner: Product Platform
fictional: true
---

# RelayOS Product Release Notes: v3.8 and v3.8.2

## Release context

These notes document two fictional RelayOS releases that are relevant to the Q2 activation review. They describe product behavior and observed support signals; they do not establish that a release was the sole cause of churn.

## v3.8 — 2026-04-08

### Role mapping change

RelayOS v3.8 made role mapping mandatory before a workspace could publish its first workflow. The change was introduced to ensure that the workflow owner had least-privilege access before execution.

The new step used the label “Execution principal” and displayed a role selector before the first workflow. The security rationale was reviewed and approved, but the copy was not tested with first-time administrators before release.

### Early support signal

From April 9 through May 31, Customer Success tagged 73 onboarding tickets as role-mapping related. Forty-one of those tickets asked which role to choose; the remaining tickets asked how to return to the prior setup step.

The most common exact customer wording in the coded sample was: “I don't know which role to choose.”

## v3.8.2 — 2026-07-02

### Clarity fixes

Version 3.8.2 changed the label “Execution principal” to “Connection role,” added one example for each role, and restored a Back action from the selector to the workflow setup step.

Sandbox workspaces can now skip integration setup and return later. Production workspaces still require a connection role before publishing a workflow.

During the first seven days after release, abandonment at the role-mapping step moved from 34% to 19%. This is an early directional signal, not a controlled experiment.

## Follow-up measurement

Product Analytics will monitor first-workflow publication within 48 hours, role-mapping abandonment, integration errors, and onboarding help requests. The guided onboarding experiment is the controlled source for treatment-versus-control results.

