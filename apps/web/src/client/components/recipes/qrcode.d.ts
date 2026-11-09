/** The `qrcode` package ships no type declarations. Only toDataURL is used. */
declare module "qrcode" {
  export type QRCodeToDataURLOptions = {
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  };

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
}
