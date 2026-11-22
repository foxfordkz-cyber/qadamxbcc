const asset = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/saq-bol-mark.svg`;

// Each placement has a visible product or account name alongside the mark.
export function BrandMark({ className = "brand-mark", size = 40 }: { className?: string; size?: number }) {
  return <img src={asset} width={size} height={size} className={className} alt="" />;
}
