// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = "dev.mosaikit.kernel.core", importOptions = ImportOption.DoNotIncludeTests.class)
class KernelCoreArchitectureTest {

    @ArchTest
    static final ArchRule resourcesGoThroughServices = noClasses()
            .that()
            .haveSimpleNameEndingWith("Resource")
            .should()
            .dependOnClassesThat()
            .areAnnotatedWith("jakarta.data.repository.Repository")
            .because("REST resources must not access repositories directly");

    @ArchTest
    static final ArchRule noDomainConcepts = noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..map..", "..layer..", "..geo..")
            .because("the kernel is domain-agnostic: domain concepts belong to plugins");

    @ArchTest
    static final ArchRule noVertxEventBus = noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("io.vertx.core.eventbus..", "io.vertx.mutiny.core.eventbus..")
            .because("plugins communicate through the kernel event bus, which keeps Quarkus 4 migration local");

    @ArchTest
    static final ArchRule noPanache = noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("io.quarkus.hibernate.orm.panache..")
            .because("persistence uses Jakarta Data repositories (ADR-0003)");
}
