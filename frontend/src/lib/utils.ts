export function cn(...inputs: any[]) {
  return inputs
    .flat()
    .filter(Boolean)
    .join(' ');
}
