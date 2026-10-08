"""
EAN-13 variable-weight barcode helper.

Barcode structure (13 digits):
  1-3   prefix           default "220"
  4-7   item code        4 digits, per-product (e.g. "8714" for Gouda cheese)
  8     separator digit  default "0"
  9-12  weight in grams  4 digits, zero-padded (e.g. 4.34 kg -> "4340")
  13    check digit      standard EAN-13 algorithm, computed here

Duplicate barcodes across different physical cartons that happen to share
the exact same weight are EXPECTED and not an error — each still gets its
own printed label.
"""


def ean13_check_digit(digits12: str) -> int:
    if len(digits12) != 12 or not digits12.isdigit():
        raise ValueError("digits12 must be exactly 12 numeric characters")
    total = 0
    for i, d in enumerate(digits12):
        n = int(d)
        total += n if i % 2 == 0 else n * 3
    return (10 - (total % 10)) % 10


def make_barcode(item_code: str, weight_kg: float, prefix: str = "220", sep_digit: str = "0") -> str:
    if len(prefix) != 3 or not prefix.isdigit():
        raise ValueError("prefix must be exactly 3 digits")
    if len(item_code) != 4 or not item_code.isdigit():
        raise ValueError("item_code must be exactly 4 digits")
    if len(sep_digit) != 1 or not sep_digit.isdigit():
        raise ValueError("sep_digit must be exactly 1 digit")

    grams = round(weight_kg * 1000)
    if grams > 9999:
        raise ValueError(f"weight {weight_kg} kg -> {grams} g does not fit in 4 digits")
    weight_str = f"{grams:04d}"

    digits12 = prefix + item_code + sep_digit + weight_str
    check = ean13_check_digit(digits12)
    return digits12 + str(check)


def parse_weight_list(raw_text: str) -> list[float]:
    """Parse a newline/comma-separated block of weights (as pasted by the user)
    into a list of floats, in the order given. Ignores blank lines. Accepts
    both '.' and ',' as the decimal separator (common in Hebrew keyboards/Excel)."""
    weights = []
    for line in raw_text.replace(",", "\n").splitlines():
        line = line.strip()
        if not line:
            continue
        line = line.replace(",", ".")  # in case a stray comma decimal slipped through
        weights.append(float(line))
    return weights


def parse_weight_rows(raw_text: str) -> list[dict]:
    """Parse a block of pasted lines into [{'weightKg': float, 'uniqueId': str}, ...].

    Each line is one carton. The unique carton ID (e.g. a "Cheese no") is
    OPTIONAL — most of the time only a weight is given. One line per carton,
    weight first, optional ID second, separated by whitespace or a tab
    (NOT a comma, since ',' may be a decimal separator in the weight itself):
        4.34         -> {"weightKg": 4.34, "uniqueId": ""}
        4.34 1219    -> {"weightKg": 4.34, "uniqueId": "1219"}
        4.34\t1219   -> {"weightKg": 4.34, "uniqueId": "1219"}
    """
    rows = []
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.replace("\t", " ").split()
        if not parts:
            continue
        weight = float(parts[0].replace(",", "."))
        unique_id = parts[1] if len(parts) > 1 else ""
        rows.append({"weightKg": weight, "uniqueId": unique_id})
    return rows
