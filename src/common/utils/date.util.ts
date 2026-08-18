export const parseOptionalDate = (value: unknown) => {
  if (!value) {
    return null;
  }

  const date = new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
};

export const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  return date;
};
