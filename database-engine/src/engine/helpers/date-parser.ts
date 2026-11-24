export class DateParser {
    static parseTimestamp(value: string): number | null {
        const normalizedValue = value.replace(" ", "T");

        const match = normalizedValue.match(
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/
        );
        
        if (!match) {
            return null; // Invalid format
        }

        const [, year, month, day, hours, minutes, seconds, fraction, zone] = match;

        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        const h = Number(hours);
        const min = Number(minutes);
        const s = Number(seconds);
        const milliseconds = fraction ? Number((fraction + "000").slice(0, 3)) : 0;

        const date = new Date(Date.UTC(y, m - 1, d, h, min, s, milliseconds));

        if (
            date.getUTCFullYear() !== y ||
            date.getUTCMonth() !== m - 1 ||
            date.getUTCDate() !== d ||
            h > 23 || min > 59 || s > 59
        ) {
            return null; // Invalid date
        }

        let timestamp = date.getTime();
        if (zone && zone !== "Z") {
            const compactZone = zone.replace(":", "");
            const sign = compactZone.startsWith("-") ? -1 : 1;
            const zoneHours = Number(compactZone.slice(1, 3));
            const zoneMinutes = Number(compactZone.slice(3, 5));
            if (zoneHours > 23 || zoneMinutes > 59) return null;
            timestamp -= sign * (zoneHours * 60 + zoneMinutes) * 60 * 1000;
        }

        return timestamp;
    }
}
