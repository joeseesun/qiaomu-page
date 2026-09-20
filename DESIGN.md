# Qiaomu Page Design Anchor

## Product and audience

Qiaomu Page is a quiet publishing workspace for creators who want to turn an AI-made page into a stable link without learning deployment tools. The dashboard must feel trustworthy before it feels clever.

## Functional contract

- Within three seconds, users can tell what changed, whether it succeeded, and what happens next.
- Publishing, account, sharing, and recovery actions keep feedback beside the control that caused them.
- Errors explain recovery. Successes confirm the changed object and any important consequence.

## Visual system

- Light, neutral canvas: `#ffffff` paper, `#171717` ink, `#666666` secondary text, `#ebebeb` hairlines.
- Chinese UI uses the system Chinese stack; Geist remains the compact Latin and number face.
- Corners stay restrained at 6–12 px. Depth uses thin borders and soft layered shadows, never glow or glass as decoration.
- Success uses a restrained evergreen accent (`#176b45`) plus a check icon and text; color never carries meaning alone.

## Interaction system

- A submitted form shows progress in the submit button without changing its size: `保存账号 → 保存中… → 已保存`.
- Important form results use a persistent inline status near the submit action. They do not disappear on a timer.
- Short, low-risk cross-page events may use a toast. If a modal is open, its toast belongs inside that modal's top layer.
- Copy controls confirm success in place and then restore their original label.
- Dynamic status uses `role="status"` / polite announcements without stealing keyboard focus.
- Motion is under 200 ms, limited to opacity and transform, and removed with `prefers-reduced-motion`.

## Component dossier: account save feedback

- User goal: know unambiguously that username or password changes are complete.
- Use when: the account form PATCH succeeds.
- Do not use when: validation or network failure occurs; use the existing inline error instead.
- Anatomy: status icon, specific title, one-sentence consequence, submit button state.
- States: hidden, saving, success, error, editing again.
- Keyboard and screen reader: keep focus on the submit button; announce the new status politely.
- Narrow viewport: full-width status and button, no overlay or horizontal overflow.
- Recovery: errors remain visible in the dialog and the form stays editable.

## Do / don't

- Do use concrete results such as “密码修改成功”.
- Do state security consequences such as other browser sessions being signed out.
- Don't place a status behind a modal backdrop or rely on blur, color, or a lone checkmark.
- Don't interrupt successful low-risk work with a second modal.
- Don't stack multiple transient notices for one action.

## Reference DNA

- Carbon: inline feedback stays next to its task, uses icon + title + concise body, and short actions expose active/finished states.
- Apple HIG: feedback intensity matches the importance of the result; ordinary success does not need another alert.
- W3C: status changes are programmatically announced without moving focus; reduced-motion preferences are respected.
