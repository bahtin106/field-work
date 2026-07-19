package expo.modules.monitormapapps

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class MonitorMapAppsModule : Module() {
  private val reactContext
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MonitorMapApps")

    AsyncFunction("getInstalledMapAppsAsync") {
      queryInstalledMapApps()
    }

    AsyncFunction("openMapAppAsync") { packageName: String, geoUri: String ->
      openMapApp(packageName, geoUri)
    }
  }

  @Suppress("DEPRECATION")
  private fun queryInstalledMapApps(): List<Map<String, String>> {
    val context = reactContext
    val packageManager = context.packageManager
    val queryIntent = Intent(Intent.ACTION_VIEW, Uri.parse(MAP_PROBE_URI))
    val handlers = packageManager.queryIntentActivities(
      queryIntent,
      android.content.pm.PackageManager.MATCH_DEFAULT_ONLY,
    )

    return handlers
      .asSequence()
      .filter { resolveInfo ->
        val activityInfo = resolveInfo.activityInfo
        activityInfo != null &&
          activityInfo.enabled &&
          activityInfo.applicationInfo?.enabled == true &&
          activityInfo.packageName != context.packageName
      }
      .mapNotNull { resolveInfo ->
        val packageName = resolveInfo.activityInfo?.packageName?.trim().orEmpty()
        if (packageName.isEmpty()) return@mapNotNull null

        val label = resolveInfo.loadLabel(packageManager)
          ?.toString()
          ?.trim()
          .orEmpty()
          .ifEmpty { packageName }

        mapOf(
          "id" to "android:$packageName",
          "packageName" to packageName,
          "label" to label,
        )
      }
      .distinctBy { app -> app.getValue("packageName") }
      .sortedBy { app -> app.getValue("label").lowercase(Locale.getDefault()) }
      .toList()
  }

  private fun openMapApp(packageName: String, geoUri: String): Boolean {
    val normalizedPackage = packageName.trim()
    if (normalizedPackage.isEmpty() || !geoUri.startsWith("geo:")) return false

    val installedPackages = queryInstalledMapApps()
      .mapTo(HashSet()) { app -> app.getValue("packageName") }
    if (normalizedPackage !in installedPackages) return false

    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(geoUri)).apply {
      setPackage(normalizedPackage)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    return try {
      reactContext.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private companion object {
    const val MAP_PROBE_URI = "geo:55.751244,37.618423?q=55.751244,37.618423"
  }
}
