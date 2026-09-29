import { Type, type FunctionDeclaration } from "@google/genai";

export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "get_current_time",
    description: "Returns the current date and time, optionally for a given IANA timezone.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timezone: { type: Type.STRING, description: "IANA timezone, e.g. Asia/Kolkata. Defaults to UTC." },
      },
    },
  },
  {
    name: "roll_dice",
    description: "Rolls an N-sided die and returns the result.",
    parameters: {
      type: Type.OBJECT,
      properties: { sides: { type: Type.INTEGER, description: "Number of sides, default 6." } },
    },
  },
];

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export const handlers: Record<string, Handler> = {
  get_current_time: ({ timezone }) => {
    const tz = typeof timezone === "string" ? timezone : "UTC";
    try {
      return { timezone: tz, time: new Date().toLocaleString("en-US", { timeZone: tz }) };
    } catch {
      return { error: `Unknown timezone: ${tz}` };
    }
  },
  roll_dice: ({ sides }) => {
    const n = typeof sides === "number" && sides > 1 ? Math.floor(sides) : 6;
    return { sides: n, result: 1 + Math.floor(Math.random() * n) };
  },
};
