type Props = {
  className?: string;
  size?: number;
  title?: string;
};

/** OnlineShare mark — amber plate with dual brackets / share glyph */
export function Logo({ className = "", size = 28, title = "OnlineShare" }: Props) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/logo.png"
      width={size}
      height={size}
      alt={title}
      decoding="async"
    />
  );
}
