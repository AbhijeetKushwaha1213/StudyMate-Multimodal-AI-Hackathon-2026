# Premium AI Generator - Design System

## 🎨 Visual Design Language

### Color Palette

#### Primary Gradients
```css
/* Purple to Pink - Main brand */
from-purple-600 via-pink-500 to-orange-500

/* Material Type Gradients */
Flashcards:  from-purple-500 to-pink-500
Mind Maps:   from-blue-500 to-cyan-500
Quiz:        from-green-500 to-emerald-500
Notes:       from-orange-500 to-amber-500
Diagrams:    from-indigo-500 to-purple-500
Summary:     from-rose-500 to-pink-500
Revision:    from-violet-500 to-purple-500
```

#### Status Colors
- Success: Green (500-700)
- Error: Red/Destructive
- Info: Blue (500-700)
- Warning: Amber (500-700)

---

## 🔲 Spacing System

### Consistent Spacing Scale
```
Gap/Padding:
- xs: 0.5rem (8px)
- sm: 0.75rem (12px)
- md: 1rem (16px)
- lg: 1.5rem (24px)
- xl: 2rem (32px)
- 2xl: 2.5rem (40px)
- 3xl: 3rem (48px)

Vertical Spacing:
- Section gaps: space-y-6 (1.5rem)
- Card spacing: space-y-4 (1rem)
- List items: space-y-2 (0.5rem)
```

---

## 📐 Border Radius

### Hierarchy
```
- Small elements (badges, buttons): rounded-lg (8px)
- Cards and containers: rounded-xl (12px)
- Hero sections: rounded-2xl (16px)
- Major sections: rounded-3xl (24px)
- Icons/avatars: rounded-full (50%)
```

---

## 🎭 Shadows

### Elevation System
```css
/* Default card */
shadow-sm

/* Hover state */
shadow-xl

/* Active/Selected */
shadow-lg + ring-4 ring-purple-500

/* Hero section */
shadow-2xl
```

---

## ✨ Animation Specifications

### Timing Functions
```css
/* Default transitions */
transition-all duration-300 ease-in-out

/* Hover effects */
hover:scale-105 transition-transform duration-300

/* Loading animations */
animate-pulse (built-in)
animate-bounce (built-in)
animate-spin (built-in)

/* Custom animations */
animate-fade-in: 0.5s ease-out
animate-slide-up: 0.6s ease-out
animate-scale-in: 0.5s ease-out
```

### Animation Delays
```css
/* Staggered card animations */
style={{ animationDelay: '0.1s' }}  // Second card
style={{ animationDelay: '0.2s' }}  // Third card
```

---

## 📝 Typography

### Font Hierarchy
```
Headings:
- h1: text-4xl font-bold (36px)
- h2: text-2xl font-bold (24px)
- h3: text-lg font-semibold (18px)

Body:
- Large: text-xl (20px)
- Base: text-base (16px)
- Small: text-sm (14px)
- Extra small: text-xs (12px)

Font Weights:
- Bold: font-bold (700)
- Semibold: font-semibold (600)
- Medium: font-medium (500)
- Regular: font-normal (400)
```

### Text Colors
```
- Primary text: text-gray-900
- Secondary text: text-gray-600
- Muted text: text-gray-500
- White text: text-white
- On gradient: text-white/90
```

---

## 🎯 Interactive Elements

### Buttons

#### Primary Button
```tsx
className="bg-gradient-to-r from-purple-600 to-pink-600 
           hover:from-purple-700 hover:to-pink-700 
           text-white font-medium px-6 py-3 rounded-lg 
           transition-all duration-300"
```

#### Secondary Button
```tsx
className="bg-white border-2 border-gray-300 
           hover:border-purple-400 text-gray-900 
           font-medium px-6 py-3 rounded-lg 
           transition-colors duration-300"
```

#### Ghost Button
```tsx
variant="ghost"
className="hover:bg-gray-100 transition-colors"
```

### Cards

#### Default Card
```tsx
className="p-6 rounded-xl shadow-sm border border-gray-200 
           bg-white hover:shadow-xl transition-all duration-300"
```

#### Interactive Card (selectable)
```tsx
className="p-6 rounded-xl shadow-sm border border-gray-200 
           cursor-pointer hover:scale-105 hover:shadow-xl 
           transition-all duration-300 
           ${selected ? 'ring-4 ring-purple-500 bg-purple-50' : ''}"
```

#### Gradient Card
```tsx
className="p-6 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 
           text-white shadow-lg"
```

---

## 🖼️ Icons

### Icon Sizes
```
- Small: w-4 h-4 (16px)
- Medium: w-5 h-5 (20px)
- Large: w-8 h-8 (32px)
- Hero: w-12 h-12 (48px)
```

### Icon Colors
```
- Primary: text-purple-600
- Secondary: text-gray-600
- Muted: text-gray-400
- Success: text-green-600
- On gradient: text-white
```

### Icon Containers
```tsx
/* Small icon badge */
<div className="w-10 h-10 bg-purple-100 rounded-full 
                flex items-center justify-center">
  <Icon className="w-5 h-5 text-purple-600" />
</div>

/* Large icon hero */
<div className="w-20 h-20 bg-gradient-to-r from-purple-500 to-pink-500 
                rounded-full flex items-center justify-center">
  <Icon className="w-10 h-10 text-white" />
</div>
```

---

## 📱 Responsive Breakpoints

### Grid Layouts
```tsx
/* Material type cards */
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"

/* Main layout with sidebar */
className="grid grid-cols-1 lg:grid-cols-3 gap-6"

/* Two-column settings */
className="grid grid-cols-2 gap-4"
className="grid grid-cols-4 gap-3"  // For buttons
```

### Hidden/Show Elements
```tsx
/* Hide sidebar on mobile */
className="hidden lg:block"

/* Show on mobile only */
className="lg:hidden"
```

---

## 🎨 Special Effects

### Glassmorphism
```tsx
className="bg-white/10 backdrop-blur-sm"
```

### Grid Background Pattern
```tsx
className="bg-grid-white/10"

/* CSS */
.bg-grid-white\/10 {
  background-image: 
    linear-gradient(to right, rgba(255, 255, 255, 0.1) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

### Pulse Glow Effect
```css
@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
  }
  50% {
    box-shadow: 0 0 40px rgba(168, 85, 247, 0.8);
  }
}
```

---

## 🎯 Component Patterns

### Step Header
```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h2 className="text-2xl font-bold text-gray-900 mb-2">
      Step Title
    </h2>
    <p className="text-gray-600">Step description</p>
  </div>
  <Button variant="ghost" onClick={goBack}>
    Back/Change
  </Button>
</div>
```

### Progress Indicator
```tsx
<div className="flex gap-2">
  {stages.map((_, i) => (
    <div
      key={i}
      className={`w-3 h-3 rounded-full transition-all ${
        i <= currentStage ? 'bg-purple-600' : 'bg-gray-300'
      }`}
    />
  ))}
</div>
```

### Status Badge
```tsx
<Badge 
  variant={isActive ? "default" : "outline"}
  className="text-xs"
>
  {label}
</Badge>
```

### Info Card
```tsx
<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 
                flex items-center gap-3">
  <Icon className="w-5 h-5 text-blue-600" />
  <div>
    <p className="text-sm font-medium text-blue-900">Title</p>
    <p className="text-sm text-blue-700">Description</p>
  </div>
</div>
```

---

## ♿ Accessibility Patterns

### Focus States
```tsx
className="focus-visible:ring-2 focus-visible:ring-purple-500 
           focus-visible:ring-offset-2"
```

### Touch Targets
```
Minimum: 44px × 44px
Buttons: py-3 px-6 (at least 48px height)
Icons: 40px × 40px clickable area
```

### ARIA Labels
```tsx
<Button aria-label="Generate flashcards with AI">
  <Sparkles /> Generate
</Button>

<Input 
  aria-describedby="topic-help"
  placeholder="Enter topic..."
/>
<p id="topic-help" className="text-sm text-gray-600">
  Describe what you want to learn
</p>
```

---

## 📏 Layout Constraints

### Max Widths
```
Page container: max-w-7xl
Content area: max-w-4xl
Hero stats: max-w-3xl
```

### Padding
```
Page: p-6
Cards: p-4 to p-6
Hero: p-8
Small elements: p-2 to p-3
```

---

## 🎨 Dark Mode Support

All components use semantic color tokens that adapt to dark mode:
```
bg-white → dark:bg-gray-900
text-gray-900 → dark:text-white
border-gray-200 → dark:border-gray-700
bg-gray-50 → dark:bg-gray-800
```

---

## 📊 Visual Hierarchy Rules

1. **Most Important**: Large, bold, gradient backgrounds
2. **Important**: Medium size, semibold, solid colors
3. **Supporting**: Base size, medium weight, muted colors
4. **Supplementary**: Small size, normal weight, gray text

---

## 🎬 Motion Principles

1. **Purposeful**: Every animation has a reason
2. **Fast**: Keep under 600ms for UI feedback
3. **Smooth**: Use ease-out for entering, ease-in for exiting
4. **Staggered**: Delay sequential items by 100ms
5. **Responsive**: Reduce motion for users who prefer it

---

## ✅ Consistency Checklist

When adding new components, ensure:
- [ ] Uses consistent spacing (multiples of 4px)
- [ ] Follows color palette
- [ ] Has proper hover/focus states
- [ ] Includes smooth transitions
- [ ] Works on mobile
- [ ] Has appropriate shadows
- [ ] Uses semantic HTML
- [ ] Includes ARIA labels
- [ ] Matches typography scale
- [ ] Has proper touch targets

---

## 🎨 Design Inspiration Sources

- **Gradient Combinations**: [uigradients.com](https://uigradients.com)
- **Color Palettes**: [tailwindcss.com/docs/customizing-colors](https://tailwindcss.com/docs/customizing-colors)
- **Animation Ideas**: [animista.net](https://animista.net)
- **Icons**: [lucide.dev](https://lucide.dev)
- **Spacing**: [Tailwind Spacing Scale](https://tailwindcss.com/docs/customizing-spacing)

---

This design system ensures visual consistency, accessibility, and a premium feel across the entire AI Generator experience!
