import type { AnalysisResult, DesignSystem, EvidenceToken } from '../src/types'

function token(
  name: string,
  value: unknown,
  role: string,
  status: EvidenceToken['status'] = 'detected',
  confidence = 0.92,
): EvidenceToken {
  return {
    name,
    value,
    role,
    source: ['web_1'],
    confidence,
    status,
  }
}

export const designSystemFixture: DesignSystem = {
  metadata: { analysis_type: 'single' },
  overview: {
    identity: 'Warm editorial utility',
    tone: ['direct', 'calm'],
    personality: ['precise'],
    density: 'comfortable',
    layout_philosophy: 'Asymmetric sections with generous gutters.',
    summary: 'A practical editorial system grounded in warm neutrals and one restrained accent.',
  },
  colors: {
    brand: [token('brand-primary', '#b84a32', 'Primary action')],
    accent: [token('accent-cyan', '#31d7e8', 'Informational accent', 'inferred', 0.74)],
    surfaces: [token('surface-canvas', '#f4f0e8', 'Page canvas')],
    text: [token('text-primary', '#1d1d1a', 'Primary text')],
    borders: [token('border-strong', '#1d1d1a', 'Structural border')],
    gradients: [],
  },
  typography: {
    families: [token('family-body', 'Geist Variable', 'UI family')],
    scale: [
      {
        name: 'display',
        family: token('display-family', 'Geist Variable', 'Display family'),
        size: token('display-size', '48px', 'Display size'),
        weight: token('display-weight', 650, 'Display weight'),
        line_height: token('display-leading', '1.05', 'Display leading'),
        letter_spacing: token('display-tracking', '-0.03em', 'Display tracking'),
        use: 'Primary page headings',
      },
      {
        name: 'body',
        family: token('body-family', 'Geist Variable', 'Body family'),
        size: token('body-size', '16px', 'Body size'),
        weight: token('body-weight', 400, 'Body weight'),
        line_height: token('body-leading', '1.5', 'Body leading'),
        letter_spacing: token('body-tracking', '0', 'Body tracking'),
        use: 'Long-form interface copy',
      },
    ],
    principles: ['Keep display copy short.'],
    substitutes: ['system-ui'],
  },
  spacing: {
    base_unit: token('space-base', '4px', 'Base unit'),
    tokens: [
      token('space-sm', '8px', 'Tight gap'),
      token('space-md', '16px', 'Default gap'),
      token('space-lg', '32px', 'Section gap'),
    ],
    section_padding: [],
    card_padding: [],
    button_padding: [],
  },
  layout: {
    values: [],
    container: [token('container-main', '80rem', 'Content max width')],
    grid: [],
    whitespace_philosophy: 'Whitespace separates major decisions.',
  },
  elevation: {
    tokens: [token('shadow-raised', '4px 4px 0 #1d1d1a', 'Raised action')],
    borders: [],
    philosophy: 'Hard offset shadows indicate interactive elevation.',
  },
  shapes: {
    radii: [token('radius-control', '0', 'Controls'), token('radius-panel', '12px', 'Panels')],
    image_geometry: [],
    aspect_ratios: [],
    cropping: 'cover',
  },
  components: [
    {
      name: 'Primary button',
      description: 'High contrast action with a hard offset shadow.',
      values: [token('button-background', '#1d1d1a', 'Button background')],
      states: [
        { name: 'default', values: [], observed: true },
        { name: 'active/pressed', values: [], observed: true },
        { name: 'focus', values: [], observed: false },
      ],
      source: ['web_1'],
      confidence: 0.88,
      status: 'interpreted',
    },
  ],
  surfaces: {
    levels: [token('surface-canvas', '#f4f0e8', 'Canvas')],
    philosophy: 'Warm layered surfaces.',
  },
  imagery: {
    elements: [],
    visual_language: 'Minimal',
    photography: 'Not observed',
    iconography: 'Bold line icons',
  },
  responsive: {
    breakpoints: [token('breakpoint-md', '768px', 'Two-column transition')],
    touch_targets: [token('touch-target', '44px', 'Minimum control target')],
    changes: [token('layout-stack', 'single-column', 'Mobile layout change')],
    image_behavior: ['Images crop to cover on narrow screens.'],
  },
  guidelines: {
    dos: ['Use one accent.'],
    donts: ['Do not add soft glows.'],
  },
  iteration_guide: [],
  agent_prompt_guide: [],
  similar_brands: [],
  quick_start: [],
  known_gaps: [
    {
      code: 'focus-evidence-limited',
      message: 'A visible focus state was not captured.',
      source: ['web_1'],
    },
  ],
  evidence: {
    sources: [
      {
        label: 'web_1',
        url: 'https://example.com/',
        weight: 100,
        status: 'analyzed',
      },
    ],
    notes: [],
  },
}

export const resultFixture: AnalysisResult = {
  success: true,
  design_md: '# Extended system\n\nExtended body.',
  design_system: designSystemFixture,
  documents: {
    compact: '# Compact system\n\nCompact body.',
    extended: '# Extended system\n\nExtended body.',
  },
  exports: {
    tailwind: '/* Tailwind-compatible */\n@theme { --color-brand-primary: #b84a32; }\n',
    css_variables: ':root { --ds-color-brand-primary: #b84a32; }\n',
    design_tokens: '{\n  "brand-primary": { "$value": "#b84a32" }\n}\n',
  },
  metadata: {
    url: 'https://example.com/',
    title: 'Example system',
    description: '',
    colors_extracted: 5,
    fonts_extracted: 1,
    usage: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      input_tokens: 13200,
      output_tokens: 5200,
      total_tokens: 18400,
      reasoning_tokens: 600,
      status: 'exact',
      estimated_cost_usd: 0.017,
      cost_status: 'estimated',
      pricing_source: 'default model table',
      sources_count: 1,
      screenshots_sent: 1,
      notes: ['Image token usage may vary by provider and screenshot dimensions.'],
    },
  },
}
