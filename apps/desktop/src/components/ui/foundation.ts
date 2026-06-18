export const municipalFontStack =
  '"Noto Sans JP", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif';

export const shellBaseClass =
  'bg-slate-100 text-[16px] leading-7 text-slate-900';

export const panelBaseClass =
  'rounded-2xl border border-slate-300 bg-white shadow-sm';

export const sectionGapClass = 'flex flex-col gap-6';

export const mergeClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');
