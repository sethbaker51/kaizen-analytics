# Kaizen Analytics Dashboard - Design Guidelines

## Design Approach: Modern SaaS Analytics Dashboard

**Selected Approach:** Design System + Industry Reference Hybrid

**Justification:** Analytics dashboards prioritize clarity, efficiency, and data comprehension. Drawing inspiration from Linear's clean aesthetics, Stripe's sophisticated data presentation, and modern SaaS dashboards like Amplitude/Mixpanel.

**Key Principles:**
- Data clarity over decoration
- Professional, trustworthy interface
- Efficient information hierarchy
- Scalable for future analytics features

---

## Core Design Elements

### A. Typography

**Font Stack:**
- Primary: Inter (Google Fonts) - Clean, modern sans-serif optimized for UI
- Monospace: JetBrains Mono - For API keys, tokens, technical data

**Hierarchy:**
- Dashboard Title: text-2xl font-semibold
- Section Headers: text-lg font-medium
- Body Text: text-base font-normal
- Labels/Metadata: text-sm font-medium
- Technical Data: text-sm font-mono
- Status Messages: text-sm font-medium

### B. Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8
- Component padding: p-4 to p-8
- Section gaps: gap-6 to gap-8
- Card spacing: p-6
- Button padding: px-6 py-2

**Grid Structure:**
- Max container width: max-w-6xl mx-auto
- Dashboard content: Single column on mobile, flexible on desktop
- Future analytics cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3

### C. Component Library

#### Navigation/Header
- Top navigation bar with "Kaizen Analytics" branding (left-aligned)
- Height: h-16
- Fixed positioning with border-b
- Right side: Future user menu placeholder
- Clean, minimal design without excessive decoration

#### Dashboard Container
- Central content area with max-w-4xl for focused view
- Padding: px-4 py-8 md:px-8 md:py-12
- Allows for future sidebar navigation if needed

#### Connection Status Card
- Prominent card design (first element users see)
- Structure: Header with icon + title, description text, action button, status area
- Rounded corners: rounded-lg
- Border: border with subtle treatment
- Padding: p-6 md:p-8
- Shadow: Subtle elevation for depth

**Card Contents:**
- Icon + "Test SP-API Connection" heading
- Descriptive text explaining the test purpose
- "Test Connection" button (primary CTA)
- Status display area (success/error messages)
- Technical details section (collapsible or always visible)

#### Buttons
- Primary button: Prominent, medium size (px-6 py-2.5)
- Rounded: rounded-md
- Font: text-sm font-medium
- States: Default, hover, active, disabled (loading state)
- Loading state: Disabled appearance with spinner icon

#### Status Display Components

**Success State:**
- Check icon (from Heroicons)
- "Connection Successful" heading (text-base font-medium)
- Timestamp or metadata (text-sm)
- JSON/data preview in code block

**Error State:**
- X-circle icon (from Heroicons)
- "Connection Failed" heading (text-base font-medium)
- Error message (text-sm)
- Technical error details in monospace font

**Code Blocks:**
- Rounded: rounded-md
- Padding: p-4
- Font: font-mono text-sm
- Overflow: overflow-x-auto for long responses

#### Icons
**Library:** Heroicons (via CDN)
- Check circle (success)
- X-circle (error)
- Refresh/loading (spinner)
- Shield check (security/auth context)
- Use size-5 or size-6 for inline icons

### D. Dashboard-Specific Patterns

**Empty State (Before First Test):**
- Centered content with illustration placeholder
- Clear call-to-action messaging
- Brief explanation of what the test validates

**Loading State:**
- Disable button with subtle opacity change
- Animated spinner icon
- "Testing connection..." text

**Data Display:**
- Key-value pairs for API response data
- Grid layout: grid grid-cols-2 gap-4 for metadata
- Labels in smaller text, values prominent
- Monospace font for technical IDs/tokens

**Future Scalability Considerations:**
- Leave conceptual space for sidebar navigation
- Card layout supports adding more status/metric cards
- Header can accommodate dropdown menus or tabs

### E. Layout Structure

**Single-Page Dashboard View:**
```
├── Header (fixed top)
│   └── Kaizen Analytics branding
├── Main Content Container (max-w-4xl, centered)
│   ├── Page Title/Welcome Section
│   ├── Connection Test Card (primary focus)
│   │   ├── Card header with icon
│   │   ├── Description
│   │   ├── Test button
│   │   └── Status display area
│   └── Future: Additional metric cards below
└── Footer (minimal, optional)
```

### F. Responsive Behavior
- Mobile (base): Single column, full-width cards with px-4
- Tablet (md): Increased padding, max-w-2xl
- Desktop (lg+): max-w-4xl, comfortable reading width
- All interactive elements: min-height of h-10 for touch targets

---

## Visual Tone
Professional SaaS aesthetic that communicates reliability and technical competence. Clean, data-focused interface that Amazon sellers would trust for business analytics. Avoid overly playful or consumer-focused design elements.