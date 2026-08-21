package com.monitorapp.buildlogic

import com.android.build.api.instrumentation.AsmClassVisitorFactory
import com.android.build.api.instrumentation.ClassContext
import com.android.build.api.instrumentation.ClassData
import com.android.build.api.instrumentation.InstrumentationParameters
import org.objectweb.asm.ClassVisitor
import org.objectweb.asm.MethodVisitor
import org.objectweb.asm.Opcodes

/**
 * Redirects only the Window color APIs disabled by Android 15.
 *
 * Several current React Native and Expo dependencies retain these calls for
 * older Android releases. Rewriting the call sites in one place lets those
 * releases keep their existing behavior while ensuring Android 15+ never
 * invokes an unsupported API.
 */
abstract class LegacySystemBarColorApiVisitorFactory
    implements AsmClassVisitorFactory<InstrumentationParameters.None> {

  private static final String WINDOW = 'android/view/Window'
  private static final String COMPAT = 'com/monitorapp/monitor/LegacySystemBarColorCompat'

  private static final Map<String, String> REDIRECTED_METHODS = [
    'getStatusBarColor()I'             : '(Landroid/view/Window;)I',
    'setStatusBarColor(I)V'            : '(Landroid/view/Window;I)V',
    'getNavigationBarColor()I'         : '(Landroid/view/Window;)I',
    'setNavigationBarColor(I)V'        : '(Landroid/view/Window;I)V',
    'getNavigationBarDividerColor()I'  : '(Landroid/view/Window;)I',
    'setNavigationBarDividerColor(I)V' : '(Landroid/view/Window;I)V',
  ].asImmutable()

  @Override
  boolean isInstrumentable(ClassData classData) {
    return classData.className != 'com.monitorapp.monitor.LegacySystemBarColorCompat' &&
        classData.className != 'com/monitorapp/monitor/LegacySystemBarColorCompat'
  }

  @Override
  ClassVisitor createClassVisitor(ClassContext classContext, ClassVisitor nextClassVisitor) {
    return new RedirectingClassVisitor(nextClassVisitor)
  }

  private static final class RedirectingClassVisitor extends ClassVisitor {
    RedirectingClassVisitor(ClassVisitor nextClassVisitor) {
      super(Opcodes.ASM9, nextClassVisitor)
    }

    @Override
    MethodVisitor visitMethod(
        int access,
        String name,
        String descriptor,
        String signature,
        String[] exceptions) {
      MethodVisitor next = super.visitMethod(access, name, descriptor, signature, exceptions)
      return new RedirectingMethodVisitor(next)
    }
  }

  private static final class RedirectingMethodVisitor extends MethodVisitor {
    RedirectingMethodVisitor(MethodVisitor nextMethodVisitor) {
      super(Opcodes.ASM9, nextMethodVisitor)
    }

    @Override
    void visitMethodInsn(
        int opcode,
        String owner,
        String name,
        String descriptor,
        boolean isInterface) {
      String replacementDescriptor =
          opcode == Opcodes.INVOKEVIRTUAL && owner == WINDOW
              ? REDIRECTED_METHODS.get("${name}${descriptor}")
              : null

      if (replacementDescriptor != null) {
        super.visitMethodInsn(
            Opcodes.INVOKESTATIC,
            COMPAT,
            name,
            replacementDescriptor,
            false)
        return
      }

      super.visitMethodInsn(opcode, owner, name, descriptor, isInterface)
    }
  }
}
