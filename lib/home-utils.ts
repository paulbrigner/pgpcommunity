import { DateTime } from "luxon";
import { createEvent } from "ics";

export const stripMarkdown = (value: string): string => {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/#{1,6}\s*(.*)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\r?\n\r?\n/g, '\n')
    .trim();
};

export const formatEventDisplay = (
  date?: string | null,
  startTime?: string | null,
  endTime?: string | null,
  timezone?: string | null
) => {
  if (!date) return { dateLabel: null, timeLabel: null };
  const zone = timezone || 'UTC';
  const dateObj = DateTime.fromISO(date, { zone });
  const dateLabel = dateObj.isValid
    ? dateObj.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)
    : date;

  let timeLabel: string | null = null;
  if (startTime) {
    const startDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone });
    const startLabel = startDateTime.isValid
      ? startDateTime.toLocaleString(DateTime.TIME_SIMPLE)
      : startTime;
    if (endTime) {
      const endDateTime = DateTime.fromISO(`${date}T${endTime}`, { zone });
      const endLabel = endDateTime.isValid
        ? endDateTime.toLocaleString(DateTime.TIME_SIMPLE)
        : endTime;
      timeLabel = `${startLabel} - ${endLabel}`;
    } else {
      timeLabel = startLabel;
    }
    if (timeLabel && timezone) {
      timeLabel = `${timeLabel} (${timezone})`;
    }
  } else if (endTime) {
    const endDateTime = DateTime.fromISO(`${date}T${endTime}`, { zone });
    const endLabel = endDateTime.isValid
      ? endDateTime.toLocaleString(DateTime.TIME_SIMPLE)
      : endTime;
    timeLabel = `Ends at ${endLabel}${timezone ? ` (${timezone})` : ''}`;
  }

  return { dateLabel, timeLabel };
};

export const buildNftKey = (contractAddress?: string | null, tokenId?: string | null) => {
  const addr = typeof contractAddress === 'string' ? contractAddress.toLowerCase() : '';
  const id = tokenId ?? 'unknown';
  return `${addr}::${id}`;
};

export const buildCalendarLinks = (
  title: string,
  date?: string | null,
  startTime?: string | null,
  endTime?: string | null,
  timezone?: string | null,
  location?: string | null,
  description?: string | null
) => {
  if (!date) return { google: null as string | null, ics: null as string | null };

  const zone = timezone || 'UTC';
  const start = startTime
    ? DateTime.fromISO(`${date}T${startTime}`, { zone })
    : DateTime.fromISO(date, { zone }).startOf('day');
  if (!start.isValid) {
    return { google: null, ics: null };
  }

  const end = endTime
    ? DateTime.fromISO(`${date}T${endTime}`, { zone })
    : start.plus({ hours: startTime ? 1 : 24 });

  const googleParams = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description || '',
    location: location || '',
  });

  const startGoogle = start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const endGoogle = end.isValid ? end.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'") : start.plus({ hours: 1 }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  googleParams.set('dates', `${startGoogle}/${endGoogle}`);

  let ics: string | null = null;
  const eventConfig: any = {
    title,
    start: [start.year, start.month, start.day, start.hour, start.minute],
    location: location || undefined,
    description: description || undefined,
    productId: 'pgpforcrypto.org',
  };

  if (end.isValid) {
    eventConfig.end = [end.year, end.month, end.day, end.hour, end.minute];
  }

  const { error, value } = createEvent(eventConfig);
  if (!error && value) {
    ics = value;
  }

  return {
    google: `https://calendar.google.com/calendar/render?${googleParams.toString()}`,
    ics,
  };
};

export const downloadIcs = (ics: string, title: string) => {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  link.href = url;
  link.download = `${safeTitle || 'event'}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
