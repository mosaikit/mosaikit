// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.contract.Contract;
import dev.mosaikit.kernel.api.contract.ContractImplementation;
import dev.mosaikit.kernel.api.contract.Contracts;
import io.quarkus.security.Authenticated;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * Stands for the Java code of a catalog and of its connectors (MK-134): the catalog owns the contract
 * "connector", whose interface would be in its API artifact; each connector implements it in a bean of
 * its own extension. The catalog lists the items of every connector it finds, and never names one.
 */
@Path("/api/v1/test/contracts")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class ContractsProbe {

    static final String CATALOG = "dev.mosaikit.test.catalog";
    static final String FILES = "dev.mosaikit.test.files-connector";
    static final String WEB = "dev.mosaikit.test.web-connector";
    static final String CARDS = "dev.mosaikit.test.cards";

    /** Version 1 of the contract of the catalog, as its API artifact would publish it. */
    @Contract(extension = CATALOG, name = "connector", version = 1)
    public interface Connector extends ContractImplementation {

        /** The items of a connection of the connector. */
        List<String> items(String connection);
    }

    /** A Java class that is not a contract. */
    public interface NotAContract extends ContractImplementation {}

    /** The connector to files. */
    @ApplicationScoped
    public static class FilesConnector implements Connector {

        @Override
        public String extension() {
            return FILES;
        }

        @Override
        public List<String> items(String connection) {
            return List.of("files:" + connection);
        }
    }

    /** The connector to web services. */
    @ApplicationScoped
    public static class WebConnector implements Connector {

        @Override
        public String extension() {
            return WEB;
        }

        @Override
        public List<String> items(String connection) {
            return List.of("web:" + connection);
        }
    }

    /** An implementation of an extension whose manifest does not declare the contract: never found. */
    @ApplicationScoped
    public static class UndeclaredConnector implements Connector {

        @Override
        public String extension() {
            return CARDS;
        }

        @Override
        public List<String> items(String connection) {
            return List.of("undeclared:" + connection);
        }
    }

    private final Contracts contracts;

    public ContractsProbe(Contracts contracts) {
        this.contracts = contracts;
    }

    /** What the catalog lists: the items of the connection "main" of every connector it finds. */
    @GET
    @Path("/items")
    public List<String> items() {
        return contracts.implementations(Connector.class).stream()
                .flatMap(connector -> connector.items("main").stream())
                .toList();
    }

    /** Asking for the implementations of an interface that is not a contract. */
    @GET
    @Path("/not-a-contract")
    public String notAContract() {
        try {
            contracts.implementations(NotAContract.class);
            return "accepted";
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }
}
