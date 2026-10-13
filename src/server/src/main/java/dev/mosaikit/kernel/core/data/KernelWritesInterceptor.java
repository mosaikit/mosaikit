// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.data;

import jakarta.annotation.Priority;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.InvocationContext;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Status;
import jakarta.transaction.SystemException;
import jakarta.transaction.TransactionManager;

/**
 * Runs the transaction of a {@link KernelWrites} method as the owner of the tables, not as the member
 * role of the request (ADR-0018). After the interceptor of {@code @Transactional}, so inside the
 * transaction it opens; without a transaction, nothing changes.
 */
@KernelWrites
@Interceptor
@Priority(Interceptor.Priority.PLATFORM_BEFORE + 300)
public class KernelWritesInterceptor {

    private final EntityManager entityManager;
    private final TransactionManager transactions;

    public KernelWritesInterceptor(EntityManager entityManager, TransactionManager transactions) {
        this.entityManager = entityManager;
        this.transactions = transactions;
    }

    @AroundInvoke
    Object asOwner(InvocationContext context) throws Exception {
        if (active()) {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
        }
        return context.proceed();
    }

    private boolean active() throws SystemException {
        return transactions.getStatus() == Status.STATUS_ACTIVE;
    }
}
