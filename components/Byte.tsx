// byte is now companion #1 in the roster. <Byte> stays as a thin alias so existing
// call-sites keep working; new code should prefer <Companion id={…} />.
import { Companion } from './Companion';

export function Byte({ size = 's28', className = '' }: { size?: string; className?: string }) {
  return <Companion id="byte" size={size} className={className} />;
}
