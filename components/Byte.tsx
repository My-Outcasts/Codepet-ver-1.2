// The byte pixel sprite — a plain <img> matching the draft's `byteSprite`.
export function Byte({ size = 's28', className = '' }: { size?: string; className?: string }) {
  return (
    <span className={`byte ${size} ${className}`.trim()}>
      <img className="bimg" src="/byte.png" alt="byte" draggable={false} />
    </span>
  );
}
