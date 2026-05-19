---
description: Create a new dashboard widget end-to-end
---

Load the `widget-development` skill first.

Create a new widget named "$ARGUMENTS". Follow the complete widget creation checklist:

1. Add the type to `src/types/widget.ts` WidgetType union
2. Create the widget component in `src/components/widgets/`
3. Register in `src/lib/dashboard-config.ts` (both work and private profiles with layout positions)
4. Import and register in `src/components/layout/dashboard-grid.tsx`
5. If the widget needs data, create an API route in `src/app/api/`

Use the WidgetWrapper, lucide-react icons, shadcn/ui components, and cn() utility. Follow all project conventions from AGENTS.md.
