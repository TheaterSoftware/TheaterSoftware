const API_BASE = "";

export async function createBooking(data: unknown) {
  const response = await fetch(
    `${API_BASE}/api/bookings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );

  const result =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.detail ??
        `HTTP ${response.status}`
    );
  }

  return result;
}

export async function updateBooking(
  bookingId: number,
  data: unknown
) {
  const response = await fetch(
    `${API_BASE}/api/bookings/${bookingId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );

  const result =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.detail ??
        `HTTP ${response.status}`
    );
  }

  return result;
}

export async function deleteBooking(
  bookingId: number
) {
  const response = await fetch(
    `${API_BASE}/api/bookings/${bookingId}`,
    {
      method: "DELETE",
    }
  );

  const result =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.detail ??
        `HTTP ${response.status}`
    );
  }

  return result;
}
