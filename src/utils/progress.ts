export function toPercent(number: any, total: any): number {
  return (parseInt(number) / parseInt(total)) * 100;
}

export function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) {
    return (bytes / 1024.0 / 1024.0 / 1024.0).toFixed(2) + ' GB';
  } else if (bytes > 1024 * 1024) {
    return (bytes / 1024.0 / 1024.0).toFixed(2) + ' MB';
  } else if (bytes > 1024) {
    return (bytes / 1024.0).toFixed(2) + ' KB';
  } else {
    return bytes.toFixed(2) + ' B';
  }
}
