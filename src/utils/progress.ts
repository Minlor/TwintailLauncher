export function toPercent(number: any, total: any): number {
  return (parseInt(number) / parseInt(total)) * 100;
}

export function formatBytes(bytes: number): string {
  if (bytes > 1000 * 1000 * 1000) {
    return (bytes / 1000.0 / 1000.0 / 1000.0).toFixed(2) + ' GB';
  } else if (bytes > 1000 * 1000) {
    return (bytes / 1000.0 / 1000.0).toFixed(2) + ' MB';
  } else if (bytes > 1000) {
    return (bytes / 1000.0).toFixed(2) + ' KB';
  } else {
    return bytes.toFixed(2) + ' B';
  }
}
