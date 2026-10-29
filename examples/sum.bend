import Base

def sum(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n++p:
      Nat.add(1n+p, sum(p))

def main() -> Nat:
  sum(100n)
