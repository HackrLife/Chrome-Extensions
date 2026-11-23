import ctypes, time
x11 = ctypes.cdll.LoadLibrary("libX11.so.6"); xt = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
xt.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xt.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xt.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
d = None
def disp():
    global d
    if d is None: d = x11.XOpenDisplay(b":99")
    return d
def kc(name): return x11.XKeysymToKeycode(disp(), x11.XStringToKeysym(name.encode()))
def move(x, y):
    xt.XTestFakeMotionEvent(disp(), -1, x, y, 0); x11.XFlush(disp()); time.sleep(0.05)
def click(x, y):
    move(x, y); xt.XTestFakeButtonEvent(disp(), 1, 1, 0); x11.XFlush(disp()); time.sleep(0.05)
    xt.XTestFakeButtonEvent(disp(), 1, 0, 0); x11.XFlush(disp()); time.sleep(0.1)
def combo(*keys):
    codes = [kc(k) for k in keys]
    for c in codes: xt.XTestFakeKeyEvent(disp(), c, 1, 0); x11.XFlush(disp()); time.sleep(0.03)
    for c in reversed(codes): xt.XTestFakeKeyEvent(disp(), c, 0, 0); x11.XFlush(disp()); time.sleep(0.03)
    time.sleep(0.2)
def drag(points):
    move(*points[0]); xt.XTestFakeButtonEvent(disp(), 1, 1, 0); x11.XFlush(disp()); time.sleep(0.05)
    for p in points[1:]: move(*p); time.sleep(0.02)
    xt.XTestFakeButtonEvent(disp(), 1, 0, 0); x11.XFlush(disp()); time.sleep(0.1)
