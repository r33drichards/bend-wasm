import Base

def mix(x: U32) -> U32:
  U32.xor(U32.or(x, 65536), 2863311530)

def kernel(x: U32) -> U32:
  y = mix(x)
  U32.and(U32.sub(y, 7), 16777215)
