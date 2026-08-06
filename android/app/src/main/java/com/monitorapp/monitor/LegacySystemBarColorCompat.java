package com.monitorapp.monitor;

import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.annotation.NonNull;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Compatibility boundary for system-bar color APIs disabled by Android 15.
 *
 * Edge-to-edge owns system-bar backgrounds on API 35+. On older releases the
 * methods are still required by React Native and Expo compatibility code, so
 * they are invoked reflectively only where Android continues to support them.
 */
public final class LegacySystemBarColorCompat {
  private static final int EDGE_TO_EDGE_ENFORCED_API = 35;
  private static final Map<String, Method> LEGACY_METHODS = new ConcurrentHashMap<>();

  private LegacySystemBarColorCompat() {}

  public static int getStatusBarColor(@NonNull Window window) {
    return getLegacyColor(window, "getStatusBarColor");
  }

  public static void setStatusBarColor(@NonNull Window window, int color) {
    setLegacyColor(window, "setStatusBarColor", color);
  }

  public static int getNavigationBarColor(@NonNull Window window) {
    return getLegacyColor(window, "getNavigationBarColor");
  }

  public static void setNavigationBarColor(@NonNull Window window, int color) {
    setLegacyColor(window, "setNavigationBarColor", color);
  }

  public static int getNavigationBarDividerColor(@NonNull Window window) {
    return getLegacyColor(window, "getNavigationBarDividerColor");
  }

  public static void setNavigationBarDividerColor(@NonNull Window window, int color) {
    setLegacyColor(window, "setNavigationBarDividerColor", color);
  }

  private static int getLegacyColor(@NonNull Window window, @NonNull String methodName) {
    if (Build.VERSION.SDK_INT >= EDGE_TO_EDGE_ENFORCED_API) {
      return Color.TRANSPARENT;
    }

    try {
      Method method = resolveLegacyMethod(methodName);
      return (Integer) method.invoke(window);
    } catch (NoSuchMethodException e) {
      return Color.TRANSPARENT;
    } catch (IllegalAccessException | InvocationTargetException | ClassCastException e) {
      throw new IllegalStateException("Unable to read a legacy system-bar color", e);
    }
  }

  private static void setLegacyColor(
      @NonNull Window window, @NonNull String methodName, int color) {
    if (Build.VERSION.SDK_INT >= EDGE_TO_EDGE_ENFORCED_API) {
      return;
    }

    try {
      Method method = resolveLegacyMethod(methodName, Integer.TYPE);
      method.invoke(window, color);
    } catch (NoSuchMethodException e) {
      // navigationBarDividerColor does not exist before API 28.
    } catch (IllegalAccessException | InvocationTargetException e) {
      throw new IllegalStateException("Unable to set a legacy system-bar color", e);
    }
  }

  private static Method resolveLegacyMethod(
      @NonNull String methodName, @NonNull Class<?>... parameterTypes)
      throws NoSuchMethodException {
    String cacheKey = methodName + '#' + parameterTypes.length;
    Method cached = LEGACY_METHODS.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    Method resolved = Window.class.getMethod(methodName, parameterTypes);
    Method previous = LEGACY_METHODS.putIfAbsent(cacheKey, resolved);
    return previous != null ? previous : resolved;
  }
}
